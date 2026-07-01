import type { PluginContext } from '@radio-services/shared';

export class FFmpegService {
  constructor(private context: PluginContext) {
    this.context.logger.info('FFmpegService initialized');
  }

  async transcode(data: { path: string; options?: Record<string, unknown> }) {
    return { jobId: 'transcode-job-id', status: 'pending', input: data.path };
  }

  async getTranscodeStatus(jobId: string) {
    return { jobId, status: 'completed', progress: 100 };
  }

  async getAudioInfo(path: string) {
    return { path, duration: 0, format: 'unknown', bitrate: 0 };
  }

  async convertFormat(_data: { path: string; outputFormat: string }) {
    return { jobId: 'convert-job-id', status: 'pending' };
  }

  async extractCoverArt(data: { path: string; outputPath?: string }) {
    return { jobId: 'extract-job-id', status: 'pending', input: data.path };
  }

  async normalizeAudio(_data: { path: string; targetLevel?: number }) {
    return { jobId: 'normalize-job-id', status: 'pending' };
  }

  async getAvailableFormats() {
    return ['mp3', 'aac', 'ogg', 'flac', 'wav'];
  }
}
