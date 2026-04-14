import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from '@/lib/env';
import {
  InvalidLlmResponseError,
  LlmTimeoutError,
  LlmUpstreamError,
} from './errors';
import { SYSTEM_PROMPT } from './contracts';
import { llmToolJsonSchema } from './schema';

type ClaudeCodeCliOptions = {
  prompt: string;
  timeoutMs: number;
  sourceImageBase64?: string | null;
};

const buildCliChildEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: process.env.NODE_ENV,
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  SHELL: process.env.SHELL,
  TMPDIR: process.env.TMPDIR,
  LANG: process.env.LANG,
  TERM: process.env.TERM,
});

const extractJsonObjectText = (value: string): string | null => {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (char === '}') {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return value.slice(start, i + 1);
      }
    }
  }

  return null;
};

export const parseClaudeCodeCliOutput = (output: string): unknown => {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new InvalidLlmResponseError('CLI response was empty');
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const extracted = extractJsonObjectText(trimmed);
    if (!extracted) {
      throw new InvalidLlmResponseError('CLI response contained no JSON object');
    }
    try {
      return JSON.parse(extracted) as unknown;
    } catch {
      throw new InvalidLlmResponseError('CLI response JSON could not be parsed');
    }
  }
};

const buildClaudeCodeCliPrompt = (
  prompt: string,
  sourceImagePath?: string,
): string => {
  const parts = [
    SYSTEM_PROMPT,
    'Return only a single JSON object. Do not include markdown fences, explanations, or any extra text.',
    `JSON schema: ${JSON.stringify(llmToolJsonSchema)}`,
  ];

  if (sourceImagePath) {
    parts.push(
      `A reference PNG is available at this local path: ${sourceImagePath}. Inspect it if useful.`,
    );
  }

  parts.push(`User prompt:\n${prompt}`);
  return parts.join('\n\n');
};

export const parsePromptViaClaudeCodeCli = async ({
  prompt,
  timeoutMs,
  sourceImageBase64 = null,
}: ClaudeCodeCliOptions): Promise<unknown> => {
  if (process.env.NODE_ENV === 'production') {
    throw new LlmUpstreamError(
      'claude_code_cli backend is only allowed in local development',
    );
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'sprite-gen-llm-'));
  let sourceImagePath: string | undefined;

  try {
    if (sourceImageBase64) {
      sourceImagePath = join(tempDir, 'source.png');
      await writeFile(sourceImagePath, Buffer.from(sourceImageBase64, 'base64'));
    }

    const runDir = join(tempDir, 'run');
    await mkdir(runDir);

    const fullPrompt = buildClaudeCodeCliPrompt(prompt, sourceImagePath);
    const child = spawn(env.LLM_CLI_COMMAND, ['-p', fullPrompt], {
      cwd: runDir,
      env: buildCliChildEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    return await new Promise<unknown>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!settled) child.kill('SIGKILL');
        }, 250).unref();
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (err) => {
        settled = true;
        clearTimeout(timeoutId);
        reject(
          new LlmUpstreamError(
            err.message || 'failed to spawn Claude Code CLI',
            err,
          ),
        );
      });

      child.on('close', (code, signal) => {
        settled = true;
        clearTimeout(timeoutId);

        if (timedOut) {
          reject(new LlmTimeoutError(`Claude Code CLI exceeded ${timeoutMs}ms`));
          return;
        }

        if (code !== 0) {
          const detail = stderr.trim() || `CLI exited with code ${code ?? 'null'} (${signal ?? 'no-signal'})`;
          reject(new LlmUpstreamError(detail));
          return;
        }

        try {
          resolve(parseClaudeCodeCliOutput(stdout));
        } catch (err) {
          reject(err);
        }
      });
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};
