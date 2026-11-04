
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { imageSize } from 'image-size';

const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image';

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
    const apiKey = process.env.GEMINI_API_KEY?.trim();

    if (!apiKey) {
      throw new ServiceUnavailableException(
        'GEMINI_API_KEY is missing. Configure it in your .env file.',
      );
    }

    const imageModelName =
      process.env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;

    try {
      const genAI = new GoogleGenerativeAI(apiKey);

      let sourceDimensions = 'same dimensions and aspect ratio as the source image';

      try {
        const dimensions = imageSize(sourceImage.buffer);

        if (dimensions.width && dimensions.height) {
          sourceDimensions =
            `${dimensions.width}x${dimensions.height} pixels ` +
            `(aspect ratio ${dimensions.width}:${dimensions.height})`;
        }
      } catch {
        this.logger.warn('Could not read source image dimensions.');
      }

      const imageModel = genAI.getGenerativeModel({
        model: imageModelName,
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT'],
        } as any,
      });

      const prompt = `
Perform a precise hairstyle transfer using the TWO supplied images.

IMAGE 1 — SOURCE PERSON:
The first image is the base photograph and the ONLY source of the person's
identity, face, body, pose, clothing, background and lighting.

IMAGE 2 — TARGET HAIRSTYLE:
The second image is the visual ground truth for the hairstyle. Copy its
hairstyle as closely as possible. Do not use the second person's face or identity.

TASK:
Edit IMAGE 1 so that its person has the hairstyle shown in IMAGE 2.
This is a hairstyle transfer, not a general restyling or a hairstyle inspired
by the reference. Adapt the target hair to the source person's head shape,
hairline, pose and camera perspective.

MATCH IMAGE 2'S HAIR:
- Overall haircut silhouette and outer contour.
- Exact parting position and direction.
- Fringe/bangs design, including the opening, separation and length.
- Hair length relative to shoulders and chest.
- Layer placement, layer lengths and face-framing strands.
- Volume distribution at crown, temples and both sides.
- Straightness, wave/curl pattern and strand texture.
- Shape, direction and density of the hair ends.
- Base hair color, undertone and highlights.

Do not preserve source-hair features that conflict with the target hairstyle.
Do not simplify the target into a generic long layered haircut.
Do not invent different bangs, extra curls, excessive volume or a different
layer structure. Prioritize matching the reference silhouette and fringe.

PRESERVE IMAGE 1'S IDENTITY:
- Keep the exact same face and facial geometry from IMAGE 1.
- Do not copy, blend or resemble the face in IMAGE 2.
- Do not change eyes, eyebrows, nose, lips, jawline, cheeks, ears, skin tone,
  expression, makeup or apparent age.
- Do not beautify, regenerate or reinterpret the face.

PRESERVE IMAGE 1'S PHOTOGRAPH:
- Keep its background, clothing, accessories, pose, camera angle and lighting.
- Keep the original framing and portrait orientation.
- Keep the complete head and face visible.
- Maintain the source dimensions/aspect ratio: ${sourceDimensions}.
- Do not crop, zoom, stretch, rotate or change the canvas shape.
- Do not add objects, text, borders, collages or comparison panels.

REALISTIC HAIR INTEGRATION:
- Fit the target hairstyle naturally to the source person's hairline and skull.
- Render believable hair strands, edges, shadows, highlights and volume.
- Make the hair connect naturally around the forehead, temples, ears, neck
  and shoulders. Avoid wig-like edges or malformed strands.

Return exactly one complete photorealistic edited image.
      `.trim();

      const imageResult = await imageModel.generateContent([
        {
          inlineData: {
            data: sourceImage.buffer.toString('base64'),
            mimeType: sourceImage.mimetype,
          },
        },
        {
          inlineData: {
            data: referenceImage.buffer.toString('base64'),
            mimeType: referenceImage.mimetype,
          },
        },
        { text: prompt },
      ]);

      const candidate = imageResult.response.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];

      const imagePart = parts.find(
        (part) => Boolean(part.inlineData?.data),
      );

      if (!imagePart?.inlineData?.data) {
        const responseText = parts
          .map((part) => part.text)
          .filter(Boolean)
          .join('\n');

        this.logger.warn(
          `Gemini returned no image. model=${imageModelName}, finishReason=${candidate?.finishReason || 'unknown'}, response=${responseText.slice(0, 500)}`,
        );

        throw new BadGatewayException(
          'Gemini did not return an edited image. Check model access and response.',
        );
      }

      const mimeType = imagePart.inlineData.mimeType || 'image/png';

      if (!mimeType.startsWith('image/')) {
        throw new BadGatewayException(
          `Gemini returned an unsupported MIME type: ${mimeType}`,
        );
      }

      const buffer = Buffer.from(
        imagePart.inlineData.data,
        'base64',
      );

      if (!buffer.length) {
        throw new BadGatewayException('Gemini returned an empty image.');
      }

      const extension = this.getFileExtension(mimeType);

      this.logger.log(
        `Hairstyle generated. model=${imageModelName}, mimeType=${mimeType}, bytes=${buffer.length}`,
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

      const message =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Gemini hairstyle generation failed. model=${imageModelName}; ${message}`,
        error instanceof Error ? error.stack : undefined,
      );

      if (/429|quota|rate.?limit/i.test(message)) {
        throw new ServiceUnavailableException(
          'Gemini rate limit or quota exceeded. Please try again later.',
        );
      }

      if (/404|not found|model/i.test(message)) {
        throw new BadGatewayException(
          `Gemini model "${imageModelName}" is unavailable for this API key. Check GEMINI_IMAGE_MODEL and model access.`,
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
