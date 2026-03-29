/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import fs from 'node:fs/promises';
import path from 'node:path';

function getArgValue(flagName) {
  const flagIndex = process.argv.indexOf(flagName);
  if (flagIndex === -1) return undefined;
  const value = process.argv[flagIndex + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripTagPrefix(versionOrTag) {
  return versionOrTag.startsWith('v') ? versionOrTag.slice(1) : versionOrTag;
}

function extractVersionInput() {
  const tagInput = getArgValue('--tag');
  const versionInput = getArgValue('--version');
  const positionalInput = process.argv
    .slice(2)
    .find((value) => !value.startsWith('--'));

  const rawInput = tagInput ?? versionInput ?? positionalInput;
  if (!rawInput) {
    throw new Error('Missing version input. Use --tag vX.Y.Z[-alpha.N] or --version X.Y.Z[-alpha.N].');
  }

  return stripTagPrefix(rawInput.trim());
}

function getSectionRange(changelogContent, version) {
  const headingRegex = new RegExp(
    `^## \\[${escapeRegExp(version)}\\] - \\d{4}-\\d{2}-\\d{2}\\s*$`,
    'm'
  );
  const headingMatch = headingRegex.exec(changelogContent);
  if (!headingMatch || headingMatch.index === undefined) {
    throw new Error(`CHANGELOG entry not found for version ${version}.`);
  }

  let sectionStart = headingMatch.index + headingMatch[0].length;
  if (changelogContent[sectionStart] === '\r') {
    sectionStart += 1;
  }
  if (changelogContent[sectionStart] === '\n') {
    sectionStart += 1;
  }
  const remaining = changelogContent.slice(sectionStart);
  const nextHeadingMatch = /^## \[/m.exec(remaining);
  const sectionEnd = nextHeadingMatch ? sectionStart + nextHeadingMatch.index : changelogContent.length;

  return {
    start: sectionStart,
    end: sectionEnd,
  };
}

function extractTitleAndBody(sectionContent, version) {
  const lines = sectionContent.replace(/\r/g, '').split('\n');
  const titleHeadingIndex = lines.findIndex((line) => /^### Title\s*$/.test(line.trim()));

  if (titleHeadingIndex === -1) {
    throw new Error(`CHANGELOG entry ${version} is missing required '### Title' heading.`);
  }

  let titleStart = titleHeadingIndex + 1;
  while (titleStart < lines.length && lines[titleStart].trim() === '') {
    titleStart += 1;
  }

  let titleEnd = titleStart;
  while (titleEnd < lines.length) {
    const currentLine = lines[titleEnd];
    if (/^###\s+/.test(currentLine.trim())) {
      break;
    }
    if (/^##\s+/.test(currentLine.trim())) {
      break;
    }
    titleEnd += 1;
  }

  const titleText = lines
    .slice(titleStart, titleEnd)
    .join(' ')
    .trim();

  if (!titleText) {
    throw new Error(`CHANGELOG entry ${version} has '### Title' but no title content.`);
  }

  const bodyLines = [...lines.slice(0, titleHeadingIndex), ...lines.slice(titleEnd)];
  const releaseBody = bodyLines.join('\n').trim();

  return { releaseTitle: titleText, releaseBody };
}

function writeGitHubOutput(key, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error('GITHUB_OUTPUT is not available. Remove --github-output or run inside GitHub Actions.');
  }

  return fs.appendFile(outputPath, `${key}<<EOF\n${value}\nEOF\n`);
}

async function main() {
  const version = extractVersionInput();
  const changelogPath = path.join(process.cwd(), 'CHANGELOG.md');
  const changelogContent = await fs.readFile(changelogPath, 'utf8');

  const { start, end } = getSectionRange(changelogContent, version);
  const sectionContent = changelogContent.slice(start, end).trim();
  const { releaseTitle, releaseBody } = extractTitleAndBody(sectionContent, version);
  const useGitHubOutput = process.argv.includes('--github-output');

  if (useGitHubOutput) {
    await writeGitHubOutput('release_title', releaseTitle);
    await writeGitHubOutput('release_body', releaseBody);
    return;
  }

  process.stdout.write(
    JSON.stringify(
      {
        version,
        releaseTitle,
        releaseBody,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
