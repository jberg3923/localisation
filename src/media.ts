import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { validateTiming, type Timing } from './model.js';

export function checkTools() {
  for (const command of ['ffmpeg', 'ffprobe']) execFileSync(command, ['-version'], { stdio: 'ignore' });
}
export function finishMedia(folder: string, steps: Timing[]) {
  const clip = join(folder, 'clip.mp4');
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-n', '-i', join(folder, 'source.webm'), '-an',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '25', '-movflags', '+faststart', clip]);
  const media = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', clip], { encoding: 'utf8' }));
  const video = media.streams.find((s: any) => s.codec_type === 'video');
  if (!video || video.codec_name !== 'h264' || video.width !== 1920 || video.height !== 1080 ||
    video.avg_frame_rate !== '25/1' || video.pix_fmt !== 'yuv420p' || media.streams.some((s: any) => s.codec_type === 'audio'))
    throw new Error('Clip does not meet the silent 1080p H.264 / 25 fps contract');
  const duration = Number(media.format.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid video duration');
  validateTiming(steps, duration);
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-xerror', '-i', clip, '-f', 'null', '-']);
  return { width: video.width, height: video.height, fps: 25, codec: video.codec_name, duration, silent: true, decode: 'passed' };
}
