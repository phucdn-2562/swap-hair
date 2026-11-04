import {
  BadRequestException,
  Controller,
  HttpStatus,
  Logger,
  Post,
  Res,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { HairstyleTryOnResult } from './hairstyle.service';
import { HairstyleService } from './hairstyle.service';

type HairstyleUploadFiles = {
  sourceImage?: Express.Multer.File[];
  referenceImage?: Express.Multer.File[];
};

const MAX_IMAGE_SIZE =
  Math.max(1, Number(process.env.MAX_IMAGE_SIZE_MB || 10)) * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

@Controller('hairstyles')
export class HairstyleController {
  private readonly logger = new Logger(HairstyleController.name);

  constructor(private readonly hairstyleService: HairstyleService) {}

  /**
   * POST /api/hairstyles/try-on
   * Multipart fields:
   * - sourceImage: original portrait/person to preserve
   * - referenceImage: image whose hairstyle should be transferred
   *
   * No authentication is required in this standalone project.
   */
  @Post('try-on')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'sourceImage', maxCount: 1 },
        { name: 'referenceImage', maxCount: 1 },
      ],
      {
        limits: {
          fileSize: MAX_IMAGE_SIZE,
          files: 2,
        },
      },
    ),
  )
  async tryOnHairstyle(
    @UploadedFiles() files: HairstyleUploadFiles,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const sourceImage = files?.sourceImage?.[0];
    const referenceImage = files?.referenceImage?.[0];

    if (!sourceImage || !referenceImage) {
      throw new BadRequestException(
        'Both sourceImage and referenceImage are required.',
      );
    }

    for (const file of [sourceImage, referenceImage]) {
      if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
        throw new BadRequestException(
          'Only JPEG, PNG and WebP images are supported.',
        );
      }

      if (!file.buffer?.length || file.size > MAX_IMAGE_SIZE) {
        throw new BadRequestException(
          `Each image must be smaller than ${Math.floor(MAX_IMAGE_SIZE / 1024 / 1024)} MB.`,
        );
      }
    }

    this.logger.log(
      `Try-on request: source=${sourceImage.size} bytes, reference=${referenceImage.size} bytes`,
    );

    const result: HairstyleTryOnResult =
      await this.hairstyleService.tryOn(sourceImage, referenceImage);

    response.setHeader('Content-Type', result.mimeType);
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${result.fileName}"`,
    );
    response.setHeader('Content-Length', String(result.buffer.length));
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-AI-Model', result.model);

    return new StreamableFile(result.buffer, {
      type: result.mimeType,
      disposition: `inline; filename="${result.fileName}"`,
      length: result.buffer.length,
    });
  }
}
