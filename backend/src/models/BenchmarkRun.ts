import { Schema, model } from "mongoose";

const benchmarkRunSchema = new Schema(
  {
    run_id: { type: String, required: true },
    source: { type: String, enum: ["cli", "api"], required: true },
    conditions: { type: Schema.Types.Mixed, required: true },
    results: { type: Schema.Types.Mixed, required: true },
    created_at: { type: Date, required: true, default: () => new Date() },
  },
  { collection: "benchmark_runs" },
);

benchmarkRunSchema.index({ run_id: 1 }, { unique: true });
benchmarkRunSchema.index({ created_at: -1 });

export const BenchmarkRun = model("BenchmarkRun", benchmarkRunSchema);
