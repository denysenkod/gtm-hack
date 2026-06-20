import { env, pipeline } from "@huggingface/transformers";
import { logError, logInfo } from "../utils/logger.js";

export type EmbeddingVector = number[];
export type EmbeddingDevice = "auto" | "gpu" | "cpu" | "wasm" | "webgpu" | "cuda" | "dml" | "coreml" | "webnn" | "webnn-gpu";

export interface EmbeddingMetadata {
  modelName: string;
  dimensions: number;
  device: EmbeddingDevice;
}

interface EmbeddingTensor {
  data: Float32Array | number[];
}

type FeatureExtractor = (
  text: string,
  options: {
    pooling: "mean";
    normalize: boolean;
  }
) => Promise<EmbeddingTensor>;

const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";

let pipelinePromise: Promise<FeatureExtractor> | null = null;

env.allowLocalModels = true;
env.allowRemoteModels = process.env.TRANSFORMERS_ALLOW_REMOTE_MODELS !== "false";
env.cacheDir = process.env.TRANSFORMERS_CACHE_DIR ?? ".data/transformers-cache";

function getModelName(): string {
  return process.env.EMBEDDING_MODEL_NAME ?? DEFAULT_MODEL;
}

function getEmbeddingDevice(): EmbeddingDevice {
  const configuredDevice = process.env.EMBEDDING_DEVICE as EmbeddingDevice | undefined;

  if (configuredDevice) {
    return configuredDevice;
  }

  if (process.platform === "win32") {
    return "dml";
  }

  if (process.platform === "linux") {
    return "cuda";
  }

  if (process.platform === "darwin") {
    return "coreml";
  }

  return "gpu";
}

function l2Normalize(vector: number[]): EmbeddingVector {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

  if (magnitude === 0) {
    return vector;
  }

  return vector.map((value) => value / magnitude);
}

async function getFeatureExtractor(): Promise<FeatureExtractor> {
  if (!pipelinePromise) {
    const modelName = getModelName();
    const device = getEmbeddingDevice();
    const startedAt = performance.now();

    logInfo("Loading embedding model", {
      modelName,
      requestedDevice: device,
      cacheDir: env.cacheDir,
      remoteModelsAllowed: env.allowRemoteModels
    });

    pipelinePromise = pipeline("feature-extraction", modelName, {
      device,
      progress_callback: (progress: unknown) => {
        if (!progress || typeof progress !== "object") {
          return;
        }

        const update = progress as {
          status?: string;
          file?: string;
          progress?: number;
          loaded?: number;
          total?: number;
        };

        if (update.status === "progress") {
          logInfo("Embedding model load progress", {
            file: update.file,
            progressPercent:
              typeof update.progress === "number" ? Number(update.progress.toFixed(1)) : undefined,
            loaded: update.loaded,
            total: update.total
          });
          return;
        }

        if (update.status) {
          logInfo("Embedding model load status", {
            status: update.status,
            file: update.file
          });
        }
      }
    }) as Promise<FeatureExtractor>;

    pipelinePromise
      .then(() => {
        logInfo("Embedding model ready", {
          modelName,
          requestedDevice: device,
          elapsedMs: Math.round(performance.now() - startedAt)
        });
      })
      .catch((error: unknown) => {
        logError("Embedding model failed to load", {
          modelName,
          requestedDevice: device,
          error: error instanceof Error ? error.message : String(error)
        });
      });
  }

  return pipelinePromise;
}

export class EmbeddingService {
  get metadata(): EmbeddingMetadata {
    return {
      modelName: getModelName(),
      dimensions: Number(process.env.EMBEDDING_DIMENSIONS ?? 384),
      device: getEmbeddingDevice()
    };
  }

  async embed(text: string): Promise<EmbeddingVector> {
    const startedAt = performance.now();
    const extractor = await getFeatureExtractor();
    let output: EmbeddingTensor;

    try {
      output = await extractor(text, {
        pooling: "mean",
        normalize: true
      });
    } catch (error) {
      logError("Embedding generation failed", {
        requestedDevice: getEmbeddingDevice(),
        textLength: text.length,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }

    const values = Array.from(output.data as Float32Array | number[]);
    logInfo("Embedding generated", {
      requestedDevice: getEmbeddingDevice(),
      dimensions: values.length,
      textLength: text.length,
      elapsedMs: Math.round(performance.now() - startedAt)
    });

    return l2Normalize(values);
  }
}
