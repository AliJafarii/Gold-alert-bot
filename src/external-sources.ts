// @ts-nocheck
const { readFile } = require('fs/promises');
const { config } = require('./config');

async function fetchExternalSources() {
  try {
    const content = await readFile(config.externalSourcesFile, 'utf8');
    const sources = JSON.parse(content);
    return Array.isArray(sources) ? sources : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

module.exports = { fetchExternalSources };
