import { Module } from '@nestjs/common';
import { HairstyleController } from './hairstyle.controller';
import { HairstyleService } from './hairstyle.service';

@Module({
  controllers: [HairstyleController],
  providers: [HairstyleService],
})
export class HairstyleModule {}
