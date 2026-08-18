/** Official latexdiff --type values. "CTAD" in the UI maps to CTRADITIONAL. */
export const MARKUP_TYPES = [
  { value: 'UNDERLINE', label: 'Underline' },
  { value: 'CTRADITIONAL', label: 'Color (CTAD)' },
  { value: 'CHANGEBAR', label: 'Change bar' },
];

export const MATH_MARKUP_LEVELS = [
  { value: 'fine', label: 'Fine' },
  { value: 'coarse', label: 'Coarse' },
  { value: 'whole', label: 'Whole' },
  { value: 'off', label: 'Off' },
];

const DEFAULT_OLD = '/old.tex';
const DEFAULT_NEW = '/new.tex';

/**
 * Build the @ARGV list passed to latexdiff-so.
 * @param {{ type?: string, mathMarkup?: string, noPreamble?: boolean, oldFile?: string, newFile?: string }} options
 * @returns {string[]}
 */
export function buildLatexdiffArgv(options = {}) {
  const {
    type = 'UNDERLINE',
    mathMarkup = 'fine',
    noPreamble = false,
    oldFile = DEFAULT_OLD,
    newFile = DEFAULT_NEW,
  } = options;

  const argv = ['--encoding=utf8'];

  if (type) {
    argv.push(`--type=${type}`);
  }
  if (mathMarkup) {
    argv.push(`--math-markup=${mathMarkup}`);
  }
  if (noPreamble) {
    argv.push('--no-preamble');
  }

  argv.push(oldFile, newFile);
  return argv;
}

/**
 * Serialize argv into a Perl list literal for Perl.eval().
 * @param {string[]} argv
 */
export function argvToPerlList(argv) {
  return argv
    .map((arg) => `'${String(arg).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)
    .join(', ');
}
