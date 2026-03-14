const { refineDictation } = require("./refineDictation");

const SAMPLE_INPUTS = [
  "plan a week long itinerary for a trip to italy that focuses on historic places and local food tours",
  "plan un itinerario de una semana por italia que se enfoque en lugares historicos y tours de comida local"
];

async function testRefineDictation(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("Provide a non-empty dictation sample to test refinement.");
  }

  const refined = await refineDictation(input);
  return {
    input,
    refined
  };
}

async function runSampleTests() {
  const results = [];

  for (const input of SAMPLE_INPUTS) {
    results.push(await testRefineDictation(input));
  }

  return results;
}

async function main() {
  const cliInput = process.argv.slice(2).join(" ").trim();

  if (cliInput) {
    const result = await testRefineDictation(cliInput);
    console.log(`Input: ${result.input}`);
    console.log(`Refined: ${result.refined}`);
    return;
  }

  const results = await runSampleTests();

  for (const result of results) {
    console.log(`Input: ${result.input}`);
    console.log(`Refined: ${result.refined}`);
    console.log("");
  }
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error || "Unknown refinement test error.");
    console.error(message);
    process.exitCode = 1;
  });
}

module.exports = {
  testRefineDictation,
  runSampleTests
};
