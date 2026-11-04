import { Module } from '@nestjs/common';
import { HairstyleModule } from './hairstyle/hairstyle.module';

@Module({
  imports: [HairstyleModule],
})
export class AppModule {}
