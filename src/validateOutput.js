const ADD_BEGIN = '\\DIFaddbegin';
const ADD_CMD = '\\DIFadd';
const ADD_END = '\\DIFaddend';
const DEL_BEGIN = '\\DIFdelbegin';
const DEL_CMD = '\\DIFdel';
const DEL_END = '\\DIFdelend';
const PREAMBLE_MACRO = '\\providecommand{\\DIFadd}';

/**
 * Inspect latexdiff-so output for the three core outcomes:
 * additions, deletions, and preamble macro definitions.
 *
 * @param {string} output
 * @returns {{
 *   hasAdditions: boolean,
 *   hasDeletions: boolean,
 *   hasPreamble: boolean,
 *   additionWrapped: boolean,
 *   deletionWrapped: boolean,
 * }}
 */
export function inspectLatexdiffOutput(output) {
  const text = String(output ?? '');
  const hasAdditions = text.includes(ADD_CMD);
  const hasDeletions = text.includes(DEL_CMD);
  const hasPreamble = text.includes(PREAMBLE_MACRO);
  const additionWrapped =
    text.includes(ADD_BEGIN) && text.includes(ADD_CMD) && text.includes(ADD_END);
  const deletionWrapped =
    text.includes(DEL_BEGIN) && text.includes(DEL_CMD) && text.includes(DEL_END);

  return {
    hasAdditions,
    hasDeletions,
    hasPreamble,
    additionWrapped,
    deletionWrapped,
  };
}

/**
 * @param {string} output
 * @param {{ expectPreamble?: boolean }} [opts]
 */
export function describeLatexdiffOutput(output, opts = {}) {
  const { expectPreamble = true } = opts;
  const info = inspectLatexdiffOutput(output);
  const problems = [];

  if (!info.additionWrapped && !info.hasAdditions) {
    problems.push('Missing addition markup (\\DIFaddbegin / \\DIFadd / \\DIFaddend).');
  }
  if (!info.deletionWrapped && !info.hasDeletions) {
    problems.push('Missing deletion markup (\\DIFdelbegin / \\DIFdel / \\DIFdelend).');
  }
  if (expectPreamble && !info.hasPreamble) {
    problems.push('Missing latexdiff preamble macros (\\providecommand{\\DIFadd}...).');
  }
  if (!expectPreamble && info.hasPreamble) {
    problems.push('Preamble macros were inserted despite --no-preamble.');
  }

  return { ok: problems.length === 0, problems, ...info };
}
