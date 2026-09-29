export const audioFormats = {
  FLAC: ['-c:a', 'flac'],
  OGG: ['-c:a', 'libvorbis', '-q:a', '5'],
  MP3: ['-c:a', 'libmp3lame', '-q:a', '2'],
  WAV: ['-c:a', 'pcm_s16le'],
} as const

export type AudioFormat = keyof typeof audioFormats

export function audioArguments(source: string, output: string, target: AudioFormat): string[] {
  return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', source, '-vn', ...audioFormats[target], output]
}
