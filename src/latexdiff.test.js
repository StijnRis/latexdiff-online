import { describe, it, expect } from 'vitest';
import { buildLatexdiffArgv, argvToPerlList, MARKUP_TYPES } from './latexdiffOptions.js';
import { inspectLatexdiffOutput, describeLatexdiffOutput } from './validateOutput.js';

describe('LaTeX Diff output validation', () => {
  it('should contain markup tags for additions and deletions', () => {
    const sampleOutput = `\\DIFdelbegin \\DIFdel{original}\\DIFdelend \\DIFaddbegin \\DIFadd{updated}\\DIFaddend`;

    expect(sampleOutput).toContain('\\DIFadd');
    expect(sampleOutput).toContain('\\DIFdel');
  });

  it('detects wrapped addition and deletion markup', () => {
    const sampleOutput = `\\DIFdelbegin \\DIFdel{original}\\DIFdelend \\DIFaddbegin \\DIFadd{updated}\\DIFaddend`;
    const info = inspectLatexdiffOutput(sampleOutput);

    expect(info.additionWrapped).toBe(true);
    expect(info.deletionWrapped).toBe(true);
    expect(info.hasPreamble).toBe(false);
  });

  it('detects preamble macro definitions', () => {
    const sampleOutput = `\\providecommand{\\DIFadd}[1]{{\\protect\\color{blue}\\uwave{#1}}}
\\providecommand{\\DIFdel}[1]{{\\protect\\color{red}\\sout{#1}}}
\\begin{document}
Hello \\DIFaddbegin \\DIFadd{Beautiful }\\DIFaddend World!
\\end{document}`;

    const info = inspectLatexdiffOutput(sampleOutput);
    expect(info.hasPreamble).toBe(true);
    expect(info.hasAdditions).toBe(true);
  });

  it('flags missing preamble when it is expected', () => {
    const sampleOutput = `\\DIFaddbegin \\DIFadd{updated}\\DIFaddend`;
    const result = describeLatexdiffOutput(sampleOutput, { expectPreamble: true });
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes('preamble'))).toBe(true);
  });

  it('accepts snippet output when --no-preamble is requested', () => {
    const sampleOutput = `\\DIFdelbegin \\DIFdel{original}\\DIFdelend \\DIFaddbegin \\DIFadd{updated}\\DIFaddend`;
    const result = describeLatexdiffOutput(sampleOutput, { expectPreamble: false });
    expect(result.ok).toBe(true);
  });
});

describe('latexdiff argv builder', () => {
  it('emits default type, math markup, and input paths', () => {
    expect(buildLatexdiffArgv()).toEqual([
      '--encoding=utf8',
      '--ignore-warnings',
      '--type=UNDERLINE',
      '--math-markup=fine',
      'old.tex',
      'new.tex',
    ]);
  });

  it('maps CTAD to the official CTRADITIONAL type value in MARKUP_TYPES', () => {
    const ctad = MARKUP_TYPES.find((t) => t.value === 'CTRADITIONAL');
    expect(ctad?.label).toContain('CTAD');
  });

  it('adds --no-preamble and custom type/math options', () => {
    expect(
      buildLatexdiffArgv({
        type: 'CHANGEBAR',
        mathMarkup: 'coarse',
        noPreamble: true,
      }),
    ).toEqual([
      '--encoding=utf8',
      '--ignore-warnings',
      '--type=CHANGEBAR',
      '--math-markup=coarse',
      '--no-preamble',
      'old.tex',
      'new.tex',
    ]);
  });

  it('serializes argv into a Perl list literal', () => {
    const perl = argvToPerlList(['--type=UNDERLINE', "/old.tex"]);
    expect(perl).toBe("'--type=UNDERLINE', '/old.tex'");
  });
});
