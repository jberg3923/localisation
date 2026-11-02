import { mkdir, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import type { Page } from 'playwright';

type Frame = { file: string; atMs: number; page: number };

// Different pages have different renderer timestamp origins. Use one monotonic
// host clock at frame receipt for the whole take, including the popup transition.
export class Capture {
  private frames: Frame[] = [];
  private pages: Page[] = [];
  private active: Page | undefined;
  private startedAt: number | undefined;
  private failure: Error | undefined;
  private stopped = false;
  private endingAt = 0;
  constructor(private folder: string) {}
  elapsed() {
    if (this.startedAt === undefined) throw new Error('Capture has no first frame');
    return Math.round(performance.now() - this.startedAt);
  }
  async follow(page: Page) {
    if (this.stopped) throw new Error('Capture already stopped');
    await mkdir(join(this.folder, 'source-frames'), { recursive: true, mode: 0o700 });
    const index = this.pages.length;
    this.pages.push(page);
    this.active = page;
    let resolveFirst!: () => void;
    const first = new Promise<void>(resolve => { resolveFirst = resolve; });
    try {
      await page.screencast.start({ size: { width: 1920, height: 1080 }, fps: 25,
        onFrame: ({ data }) => {
          if (this.stopped || this.failure || this.active !== page) return;
          const now = performance.now();
          this.startedAt ??= now;
          const file = `frame-${String(this.frames.length).padStart(8, '0')}.jpg`;
          try {
            // Synchronous, numbered writes preserve callback order without an
            // unbounded queue when disk throughput falls behind capture.
            writeFileSync(join(this.folder, 'source-frames', file), data, { mode: 0o600 });
            this.frames.push({ file, atMs: now - this.startedAt, page: index });
            resolveFirst();
          } catch (error) { this.failure = error instanceof Error ? error : new Error('Frame write failed'); resolveFirst(); }
        }
      });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([first, new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('No frames received from the active tab')), 15000);
        })]);
      } finally { clearTimeout(timeout); }
      if (this.failure) throw this.failure;
    } catch (error) { this.failure = error instanceof Error ? error : new Error('Screencast failed'); throw this.failure; }
  }
  async stop() {
    this.endingAt = this.startedAt === undefined ? 0 : this.elapsed();
    this.stopped = true;
    const results = await Promise.allSettled(this.pages.map(page => page.screencast.stop()));
    await writeFile(join(this.folder, 'frames.json'), JSON.stringify({
      clock: 'monotonic host receipt time', durationMs: this.endingAt, frames: this.frames
    }, null, 2));
    const failed = results.find(r => r.status === 'rejected');
    if (this.failure) throw this.failure;
    if (failed?.status === 'rejected') throw failed.reason;
    if (!this.frames.length || this.endingAt <= 0) throw new Error('Capture is empty');
    if (this.pages.some((_, index) => !this.frames.some(frame => frame.page === index)))
      throw new Error('A tab produced no captured frames');
  }
  renderSource() {
    if (!this.stopped || this.failure) throw new Error('Capture must finish successfully before encoding');
    const lines = ['ffconcat version 1.0'];
    for (let i = 0; i < this.frames.length; i++) {
      const current = this.frames[i];
      const end = this.frames[i + 1]?.atMs ?? this.endingAt;
      lines.push(`file 'source-frames/${current.file}'`, `duration ${Math.max(0.001, (end - current.atMs) / 1000)}`);
    }
    lines.push(`file 'source-frames/${this.frames.at(-1)!.file}'`);
    writeFileSync(join(this.folder, 'frames.ffconcat'), lines.join('\n') + '\n');
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-n', '-f', 'concat', '-safe', '1',
      '-i', join(this.folder, 'frames.ffconcat'), '-t', String(this.endingAt / 1000),
      '-r', '25', '-fps_mode', 'cfr', '-c:v', 'libvpx', '-deadline', 'realtime',
      '-cpu-used', '8', '-threads', '2', '-b:v', '6M', '-pix_fmt', 'yuv420p', join(this.folder, 'source.webm')]);
    const intervals = this.frames.slice(1).map((frame, i) => frame.atMs - this.frames[i].atMs);
    return { adapter: 'multi-page JPEG timeline', pages: this.pages.length, frameCount: this.frames.length,
      maxFrameGapMs: Math.round(Math.max(0, ...intervals)), durationMs: this.endingAt,
      cursor: 'not decorated', visualReview: 'pending' };
  }
}
