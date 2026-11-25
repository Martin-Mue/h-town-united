/// <reference lib="webworker" />
/**
 * Runs the dart detection model off the main thread. The page sends a camera frame (RGBA), this worker turns it into
 * the model's input, runs the model and sends the raw output back; decoding stays on the page (dartModel.ts). While
 * the model works, the page keeps scrolling, tapping and drawing the camera picture.
 *
 * Messages in:  { id, type: "load", modelUrl, inputSize } | { id, type: "run", width, height, rgba: Uint8ClampedArray }
 * Messages out: { id, ok: true, dims?, data? } | { id, ok: false, error }
 */
import * as ort from "onnxruntime-web/wasm";

ort.env.wasm.wasmPaths = "/ort/";
ort.env.wasm.numThreads = 1;

let sessionPromise: Promise<ort.InferenceSession> | null = null;

function load(modelUrl: string, inputSize: number): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(modelUrl, { executionProviders: ["wasm"] }).then(async (created) => {
      // the first run of a fresh session is much slower: pay it now, while the camera is still starting
      try {
        const blank = new ort.Tensor("float32", new Float32Array(3 * inputSize * inputSize), [1, 3, inputSize, inputSize]);
        await created.run({ [created.inputNames[0]]: blank });
      } catch {
        // warm-up only
      }
      return created;
    });
    sessionPromise.catch(() => { sessionPromise = null; });
  }
  return sessionPromise;
}

function toTensor(width: number, height: number, data: Uint8ClampedArray): ort.Tensor {
  const plane = width * height;
  const chw = new Float32Array(3 * plane);
  for (let i = 0, p = 0; p < plane; i += 4, p++) {
    chw[p] = data[i] / 255;
    chw[plane + p] = data[i + 1] / 255;
    chw[2 * plane + p] = data[i + 2] / 255;
  }
  return new ort.Tensor("float32", chw, [1, 3, height, width]);
}

const scope = self as unknown as DedicatedWorkerGlobalScope;
let lastModel: { url: string; size: number } | null = null;

scope.onmessage = async (event: MessageEvent) => {
  const msg = event.data as
    | { id: number; type: "load"; modelUrl: string; inputSize: number }
    | { id: number; type: "run"; width: number; height: number; rgba: Uint8ClampedArray };
  try {
    if (msg.type === "load") {
      lastModel = { url: msg.modelUrl, size: msg.inputSize };
      await load(msg.modelUrl, msg.inputSize);
      scope.postMessage({ id: msg.id, ok: true });
      return;
    }
    if (!lastModel) throw new Error("model not loaded");
    const session = await load(lastModel.url, lastModel.size);
    const results = await session.run({ [session.inputNames[0]]: toTensor(msg.width, msg.height, msg.rgba) });
    const output = results[session.outputNames[0]];
    const data = new Float32Array(output.data as Float32Array);
    scope.postMessage({ id: msg.id, ok: true, dims: output.dims, data }, [data.buffer]);
  } catch (err) {
    scope.postMessage({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
