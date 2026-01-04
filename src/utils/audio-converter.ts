import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { Readable, PassThrough } from 'stream';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Configura o caminho do ffmpeg
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

/**
 * Converte um buffer de áudio WebM para OGG Opus
 * @param inputBuffer Buffer contendo o áudio WebM
 * @returns Promise<Buffer> Buffer contendo o áudio OGG Opus
 */
export async function convertWebmToOgg(inputBuffer: Buffer<ArrayBuffer>): Promise<Buffer<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    // Usa arquivos temporários para maior compatibilidade
    const tempDir = os.tmpdir();
    const inputPath = path.join(tempDir, `input_${Date.now()}.webm`);
    const outputPath = path.join(tempDir, `output_${Date.now()}.ogg`);

    // Escreve o buffer de entrada no arquivo temporário
    fs.writeFileSync(inputPath, inputBuffer);

    ffmpeg(inputPath)
      .audioCodec('libopus')
      .audioChannels(1)
      .audioFrequency(48000)
      .audioBitrate('64k')
      .format('ogg')
      .on('start', (cmd) => {
        console.log('[AudioConverter] FFmpeg command:', cmd);
      })
      .on('error', (err) => {
        console.error('[AudioConverter] FFmpeg error:', err.message);
        // Limpa arquivos temporários
        try {
          if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        } catch {
          // Ignora erros de limpeza
        }
        reject(new Error(`Audio conversion failed: ${err.message}`));
      })
      .on('end', () => {
        console.log('[AudioConverter] Conversion completed successfully');
        try {
          // Lê o arquivo de saída
          const outputBuffer = fs.readFileSync(outputPath) as Buffer<ArrayBuffer>;

          // Limpa arquivos temporários
          fs.unlinkSync(inputPath);
          fs.unlinkSync(outputPath);

          resolve(outputBuffer);
        } catch (err) {
          reject(new Error(`Failed to read converted audio: ${err}`));
        }
      })
      .save(outputPath);
  });
}

/**
 * Verifica se o buffer é um arquivo WebM
 * @param buffer Buffer a verificar
 * @returns boolean
 */
export function isWebmBuffer(buffer: Buffer): boolean {
  // WebM files start with EBML header: 0x1A 0x45 0xDF 0xA3
  if (buffer.length < 4) return false;
  return buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3;
}

/**
 * Detecta o tipo de áudio pelo buffer
 * @param buffer Buffer a analisar
 * @returns string mimetype detectado
 */
export function detectAudioType(buffer: Buffer): string {
  if (buffer.length < 4) return 'application/octet-stream';

  // WebM/Matroska: 0x1A 0x45 0xDF 0xA3
  if (buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) {
    return 'audio/webm';
  }

  // OGG: 'OggS'
  if (buffer[0] === 0x4F && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) {
    return 'audio/ogg';
  }

  // MP3: ID3 tag or sync word
  if ((buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) || // ID3
      (buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0)) { // Sync
    return 'audio/mpeg';
  }

  // MP4/M4A: 'ftyp' at offset 4
  if (buffer.length >= 8 &&
      buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
    return 'audio/mp4';
  }

  // WAV: 'RIFF'
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    return 'audio/wav';
  }

  return 'application/octet-stream';
}
