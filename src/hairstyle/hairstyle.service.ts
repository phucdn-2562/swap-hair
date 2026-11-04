import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { imageSize } from 'image-size';
import type { Express } from 'express';

const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image';
const DEFAULT_ANALYSIS_MODEL = 'gemini-2.5-flash';

export type HairstyleTryOnResult = {
  model: string;
  mimeType: string;
  fileName: string;
  buffer: Buffer;
};

@Injectable()
export class HairstyleService {
  private readonly logger = new Logger(HairstyleService.name);

  async tryOn(
    sourceImage: Express.Multer.File,
    referenceImage: Express.Multer.File,
  ): Promise<HairstyleTryOnResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'GEMINI_API_KEY is missing. Configure it in your .env file.',
      );
    }

    const imageModelName =
      process.env.GEMINI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
    const analysisModelName =
      process.env.GEMINI_ANALYSIS_MODEL || DEFAULT_ANALYSIS_MODEL;

    try {
      const genAI = new GoogleGenerativeAI(apiKey);

      // Read the source dimensions so the image model can preserve its framing.
      let sourceDimensions = 'portrait orientation';
      try {
        const dimensions = imageSize(sourceImage.buffer);
        if (dimensions.width && dimensions.height) {
          sourceDimensions =
            `${dimensions.width}x${dimensions.height} pixels, ` +
            `aspect ratio ${dimensions.width}:${dimensions.height}`;
        }
      } catch {
        this.logger.warn('Could not read source image dimensions.');
      }

      // STAGE 1:
      // Analyze ONLY the hairstyle in the reference image.
      // The reference person's face is never passed to the image-generation call.
      const analysisModel = genAI.getGenerativeModel({
        model: analysisModelName,
      });

      const analysisResult = await analysisModel.generateContent([
        {
          inlineData: {
            data: referenceImage.buffer.toString('base64'),
            mimeType: referenceImage.mimetype,
          },
        },
        {
          text: `
Analyze the hairstyle in this reference photo for a hairstyle-transfer task.

Describe ONLY the hair. Do not describe the person's face, identity, age,
skin, makeup, expression, clothing, or background.

Include:
- haircut and overall silhouette
- hair length relative to shoulders/chest
- parting and fringe/bangs
- layers and face-framing strands
- curl/wave pattern and texture
- volume and shape around the sides and back
- hair color and highlights

Be concise but specific enough that another image model can recreate this
hairstyle on a different person. Do not infer or mention the reference person's
identity or facial characteristics.
          `.trim(),
        },
      ]);

      const hairstyleDescription =
        analysisResult.response.text()?.trim();

      if (!hairstyleDescription) {
        throw new BadGatewayException(
          'Gemini could not analyze the reference hairstyle. Please try another reference image.',
        );
      }

      this.logger.log(
        `Reference hairstyle analyzed using ${analysisModelName}: ${hairstyleDescription.slice(0, 350)}`,
      );

      // STAGE 2:
      // The image model receives ONLY the original/source photo and a textual
      // hairstyle description. It never sees the reference person's face.
      const imageModel = genAI.getGenerativeModel({
        model: imageModelName,
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT'],
        } as any,
      });

      const editPrompt = `
Edit the provided source portrait. This is a localized hairstyle-change task.

THE PROVIDED IMAGE IS THE SOURCE PERSON AND THE ONLY IDENTITY SOURCE.
Keep this exact person. Do not replace, reinterpret, beautify, or regenerate
their face.

CHANGE ONLY THE HAIR to the following hairstyle:
${hairstyleDescription}

IDENTITY PRESERVATION:
- Preserve the source person's facial identity and facial geometry.
- Keep their eyes, eyebrows, nose, lips, jawline, cheeks, ears, skin tone,
  expression, makeup and apparent age unchanged.
- Do not invent a new face or use another person's identity.
- Do not alter the face to resemble a hairstyle reference model.
- Keep the original head position and face proportions.

PHOTO PRESERVATION:
- Preserve the source photo's background, clothes, accessories, pose,
  camera angle, lighting and composition.
- Keep the same portrait orientation and aspect ratio as the source image
  (${sourceDimensions}).
- Keep the entire head and full face visible, including forehead, eyes,
  nose, mouth, chin and jaw.
- Do not zoom in, crop, stretch, rotate, or change the canvas orientation.
- Fill the entire output canvas with a complete finished photograph.
- No blank, gray, white, transparent, masked, or unfinished regions.

HAIR REALISM:
- Make the new hairstyle fit the source person's actual head shape and hairline.
- Render natural hair strands, believable volume, shadows and highlights.
- Keep the hair physically coherent around the forehead, temples, ears,
  shoulders and neck.

Return exactly one complete photorealistic edited image. Do not return a
collage, split-screen, before/after comparison, or explanatory text.
      `.trim();

      const imageResult = await imageModel.generateContent([
        {
          inlineData: {
            data: sourceImage.buffer.toString('base64'),
            mimeType: sourceImage.mimetype,
          },
        },
        { text: editPrompt },
      ]);

      const candidate = imageResult.response.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      const imagePart = parts.find(
        (part) => Boolean(part.inlineData?.data),
      );

      if (!imagePart?.inlineData?.data) {
        const modelText = parts
          .map((part) => part.text)
          .filter(Boolean)
          .join('\n');

        this.logger.warn(
          `Gemini returned no image. model=${imageModelName}, finishReason=${candidate?.finishReason || 'unknown'}, response=${modelText.slice(0, 500)}`,
        );

        throw new BadGatewayException(
          'Gemini did not return an edited image. Check the model response and try again.',
        );
      }

      const mimeType = imagePart.inlineData.mimeType || 'image/png';
      if (!mimeType.startsWith('image/')) {
        throw new BadGatewayException(
          `Gemini returned an unsupported MIME type: ${mimeType}`,
        );
      }

      const buffer = Buffer.from(imagePart.inlineData.data, 'base64');
      if (!buffer.length) {
        throw new BadGatewayException('Gemini returned an empty image.');
      }

      const extension = this.getFileExtension(mimeType);

      this.logger.log(
        `Hairstyle generated. analysisModel=${analysisModelName}, imageModel=${imageModelName}, mimeType=${mimeType}, bytes=${buffer.length}`,
      );

      return {
        model: imageModelName,
        mimeType,
        fileName: `hairstyle-result.${extension}`,
        buffer,
      };
    } catch (error) {
      if (
        error instanceof BadGatewayException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Gemini hairstyle generation failed. imageModel=${imageModelName}; ${message}`,
        error instanceof Error ? error.stack : undefined,
      );

      if (/429|quota|rate.?limit/i.test(message)) {
        throw new ServiceUnavailableException(
          'Gemini rate limit or quota exceeded. Please try again later.',
        );
      }

      throw new InternalServerErrorException(
        'Failed to generate hairstyle image with Gemini.',
      );
    }
  }

  private getFileExtension(mimeType: string): string {
    switch (mimeType) {
      case 'image/jpeg':
        return 'jpg';
      case 'image/webp':
        return 'webp';
      case 'image/png':
      default:
        return 'png';
    }
  }
}
