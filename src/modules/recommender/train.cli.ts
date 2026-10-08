/**
 * `npm run ml:train` — rebuilds the recommender from the seeded catalog: generates the synthetic
 * dataset, trains the Decision Tree, prints its held-out test metrics, and saves the model to
 * RECOMMENDER_MODEL_PATH plus the dataset next to it. Restart the server afterwards to load it.
 */
/* eslint-disable no-console -- CLI output */
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { prisma } from "../../db/client.js";
import { saveModel, trainModel } from "./model.js";

async function main() {
  const started = Date.now();
  const { model, candidates, rows } = await trainModel();
  const modelPath = await saveModel(model.saved);
  const datasetPath = join(dirname(modelPath), "synthetic-dataset.json");
  await writeFile(
    datasetPath,
    JSON.stringify({
      generatedAt: model.saved.trainedAt,
      featureNames: model.saved.featureNames,
      candidates: candidates.map(({ candidate, postUtmePercent }) => ({ ...candidate, postUtmePercent })),
      rows,
    }),
  );

  const { dataset, metrics } = model.saved;
  console.log(`Trained in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(
    `Dataset: ${dataset.candidates} synthetic candidates, ${dataset.rows} rows (${dataset.trainRows} train / ${dataset.testRows} test)`,
  );
  console.log(
    `Test metrics: accuracy ${metrics.accuracy}, precision ${metrics.precision}, recall ${metrics.recall}`,
  );
  console.table(metrics.confusionMatrix);
  console.log(`Model saved to ${modelPath}`);
  console.log(`Dataset saved to ${datasetPath}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
