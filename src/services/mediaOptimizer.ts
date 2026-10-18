import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { spawnSync } from 'child_process';

const BASE_DIR = process.cwd();
const TEMP_DIR = join(BASE_DIR, 'data', 'temp');

export interface OptimizationResult {
  data: ArrayBuffer;
  fileName: string;
  isCompressed: boolean;
  isOversized: boolean;
  originalSizeBytes: number;
  finalSizeBytes: number;
  warning?: string;
}

export class MediaOptimizer {
  private static instance: MediaOptimizer;
  private ffmpegAvailable: boolean | null = null;
  public readonly MAX_SAFE_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB

  private constructor() {
    this.ensureTempDir();
  }

  public static getInstance(): MediaOptimizer {
    if (!MediaOptimizer.instance) {
      MediaOptimizer.instance = new MediaOptimizer();
    }
    return MediaOptimizer.instance;
  }

  private ensureTempDir(): void {
    if (!existsSync(TEMP_DIR)) {
      try {
        mkdirSync(TEMP_DIR, { recursive: true });
      } catch (err) {
        console.error('[MediaOptimizer] Error creating temp dir:', err);
      }
    }
  }

  public isFfmpegInstalled(): boolean {
    if (this.ffmpegAvailable !== null) {
      return this.ffmpegAvailable;
    }
    try {
      const res = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 5000 });
      this.ffmpegAvailable = res.status === 0;
    } catch {
      this.ffmpegAvailable = false;
    }
    return this.ffmpegAvailable;
  }

  public formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  public async optimizeVideo(
    fileData: ArrayBuffer | Uint8Array | Blob,
    fileName: string
  ): Promise<OptimizationResult> {
    const uint8 = fileData instanceof Uint8Array
      ? fileData
      : (fileData instanceof ArrayBuffer ? new Uint8Array(fileData) : new Uint8Array(await fileData.arrayBuffer()));

    const originalSizeBytes = uint8.byteLength;

    // If size <= 50 MB, no compression needed
    if (originalSizeBytes <= this.MAX_SAFE_VIDEO_BYTES) {
      return {
        data: uint8.buffer as ArrayBuffer,
        fileName,
        isCompressed: false,
        isOversized: false,
        originalSizeBytes,
        finalSizeBytes: originalSizeBytes
      };
    }

    const origFormatted = this.formatBytes(originalSizeBytes);
    console.log(`[MediaOptimizer] Large video detected (${origFormatted}): "${fileName}"`);

    // Check ffmpeg availability
    if (!this.isFfmpegInstalled()) {
      const warning = `⚠️ حجم ویدیو (${origFormatted}) بیش از سقف ۵۰ مگابایت بله/روبیکا است و به دلیل نصب نبودن ffmpeg فشرده نشد.`;
      console.warn(`[MediaOptimizer] ${warning}`);
      return {
        data: uint8.buffer as ArrayBuffer,
        fileName,
        isCompressed: false,
        isOversized: true,
        originalSizeBytes,
        finalSizeBytes: originalSizeBytes,
        warning
      };
    }

    // Process with ffmpeg
    this.ensureTempDir();
    const id = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const inputPath = join(TEMP_DIR, `input_${id}.mp4`);
    const outputPath = join(TEMP_DIR, `compressed_${id}.mp4`);

    try {
      writeFileSync(inputPath, uint8);

      console.log(`[MediaOptimizer] Compressing video with ffmpeg...`);
      const proc = spawnSync('ffmpeg', [
        '-y',
        '-i', inputPath,
        '-vf', "scale='min(1280,iw)':-2",
        '-c:v', 'libx264',
        '-crf', '28',
        '-preset', 'faster',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        outputPath
      ], { timeout: 120000 });

      if (proc.status === 0 && existsSync(outputPath)) {
        const compressedBuffer = readFileSync(outputPath);
        const finalSizeBytes = compressedBuffer.byteLength;
        const newFormatted = this.formatBytes(finalSizeBytes);

        console.log(`[MediaOptimizer] Video successfully compressed from ${origFormatted} to ${newFormatted}`);

        return {
          data: compressedBuffer.buffer as ArrayBuffer,
          fileName: fileName.replace(/\.[^/.]+$/, '') + '_compressed.mp4',
          isCompressed: true,
          isOversized: finalSizeBytes > this.MAX_SAFE_VIDEO_BYTES,
          originalSizeBytes,
          finalSizeBytes
        };
      } else {
        console.warn('[MediaOptimizer] ffmpeg failed to compress, falling back to original');
      }
    } catch (err: any) {
      console.error('[MediaOptimizer] Error during video compression:', err);
    } finally {
      try {
        if (existsSync(inputPath)) unlinkSync(inputPath);
        if (existsSync(outputPath)) unlinkSync(outputPath);
      } catch {}
    }

    return {
      data: uint8.buffer as ArrayBuffer,
      fileName,
      isCompressed: false,
      isOversized: true,
      originalSizeBytes,
      finalSizeBytes: originalSizeBytes,
      warning: `حجم ویدیو ${origFormatted} است و عملیات فشرده‌سازی کامل نشد.`
    };
  }
}

export const mediaOptimizer = MediaOptimizer.getInstance();
