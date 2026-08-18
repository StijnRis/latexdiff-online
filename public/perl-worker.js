/* Classic worker: boots WebPerl off the UI thread and runs latexdiff-so. */

const workerDir = self.location.href.replace(/[^/]+$/, '');
const webperlUrl = workerDir + 'webperl.js';

function installDomShim() {
  const scriptEl = { src: webperlUrl };
  const head = {
    appendChild(el) {
      if (el && el.src) {
        importScripts(el.src);
      }
      return el;
    },
  };

  self.window = self;
  self.alert = (msg) => {
    console.error(String(msg));
  };
  self.document = {
    querySelectorAll() {
      return [];
    },
    getElementsByTagName(tag) {
      if (tag === 'script') return [scriptEl];
      if (tag === 'head') return [head];
      return [];
    },
    createElement(tag) {
      if (tag === 'script') {
        return { async: true, defer: true, src: '' };
      }
      if (tag === 'textarea') {
        return { id: '', rows: 0, cols: 0, setAttribute() {}, value: '' };
      }
      return {};
    },
    currentScript: scriptEl,
  };
}

installDomShim();
importScripts(webperlUrl);

let perlReady = false;
let latexdiffMounted = false;

function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

function captureOutput() {
  let stdout = '';
  let stderr = '';
  Perl.output = (str, chan) => {
    if (chan === 2) stderr += str;
    else stdout += str;
  };
  return {
    read() {
      return { stdout, stderr };
    },
  };
}

function perlStringLiteral(value) {
  return JSON.stringify(String(value));
}

/** latexdiff warns about kpsewhich/listings when no TeX live is available. */
function stripBenignStderr(stderr) {
  return String(stderr || '')
    .split(/\r?\n/)
    .filter((line) => {
      const text = line.trim();
      if (!text) return false;
      if (/listings package not detected/i.test(text)) return false;
      if (/Disabling mark-up in verbatim/i.test(text)) return false;
      if (/Use of uninitialized value/i.test(text)) return false;
      return true;
    })
    .join('\n')
    .trim();
}

async function mountLatexdiff() {
  const res = await fetch(new URL('latexdiff-so', self.location.href));
  if (!res.ok) {
    throw new Error(`Failed to fetch latexdiff-so (${res.status})`);
  }
  const latexdiffCode = (await res.text()).replace(
    /defined\(\s*\$packages\{"listings"\}\s*\)\s+or\s+`kpsewhich listings\.sty`\s+ne\s+""/,
    'defined($packages{"listings"})',
  );
  if (typeof FS !== 'undefined' && FS.writeFile) {
    FS.writeFile('/latexdiff.pl', latexdiffCode);
  } else {
    Perl.eval(`
      open(my $fh, '>', '/latexdiff.pl') or die $!;
      print $fh ${perlStringLiteral(latexdiffCode)};
      close($fh);
    `);
  }
  latexdiffMounted = true;
}

function initPerl() {
  Perl.noMountIdbfs = true;
  Perl.trace = false;
  Perl.init(async () => {
    try {
      Perl.start(['-e', '1']);
      await mountLatexdiff();
      perlReady = true;
      post('ready');
    } catch (err) {
      post('error', { message: err && err.message ? err.message : String(err) });
    }
  });
}

function runLatexdiff({ oldText, newText, argv }) {
  if (!perlReady || !latexdiffMounted) {
    throw new Error('WebPerl is not ready yet.');
  }
  if (!Array.isArray(argv) || argv.length < 2) {
    throw new Error('Missing latexdiff arguments.');
  }

  const capture = captureOutput();

  if (typeof FS !== 'undefined' && FS.writeFile) {
    FS.writeFile('/old.tex', String(oldText ?? ''));
    FS.writeFile('/new.tex', String(newText ?? ''));
  } else {
    Perl.eval(`
      open(my $f1, '>', '/old.tex') or die $!;
      print $f1 ${perlStringLiteral(oldText)};
      close($f1);

      open(my $f2, '>', '/new.tex') or die $!;
      print $f2 ${perlStringLiteral(newText)};
      close($f2);
    `);
  }

  const argList = argv.map((arg) => perlStringLiteral(arg)).join(', ');
  // latexdiff reads markup macros from the DATA appendix after __END__.
  // `do FILE` does not bind DATA, so eval the script with DATA opened on the file.
  Perl.eval(
    [
      "$0 = '/latexdiff.pl';",
      "open(DATA, '<', '/latexdiff.pl') or die \"Cannot open latexdiff-so: $!\";",
      "open(my $srcfh, '<', '/latexdiff.pl') or die $!;",
      'my $code = do { local $/; <$srcfh> };',
      'close $srcfh;',
      '$code =~ s/^__END__\\s*[\\r\\n].*//s;',
      "no warnings 'redefine';",
      '*CORE::GLOBAL::exit = sub { die "LATEXDIFF_EXIT:" . ($_[0] // 0) . "\\n" };',
      '*CORE::GLOBAL::readpipe = sub { "" };',
      `@ARGV = (${argList});`,
      'eval $code;',
      'my $err = $@;',
      'if ($err && $err !~ /^LATEXDIFF_EXIT:0\\b/) { die $err; }',
      '1;',
    ].join('\n'),
  );

  const { stdout, stderr: rawStderr } = capture.read();
  const stderr = stripBenignStderr(rawStderr);
  if (stderr && !stdout) {
    throw new Error(stderr);
  }

  const noPreamble = argv.includes('--no-preamble');
  if (
    !noPreamble &&
    stdout.includes('%DIF PREAMBLE EXTENSION ADDED BY LATEXDIFF') &&
    !stdout.includes('\\providecommand{\\DIFadd}')
  ) {
    throw new Error(
      stderr || 'latexdiff did not insert preamble macros, so the result would not compile.',
    );
  }

  return { output: stdout, stderr };
}

self.onmessage = (event) => {
  const data = event.data || {};
  try {
    if (data.type === 'init') {
      post('status', { message: 'Loading…' });
      initPerl();
      return;
    }
    if (data.type === 'run') {
      post('status', { message: 'Running latexdiff…' });
      const result = runLatexdiff(data);
      post('result', result);
      return;
    }
  } catch (err) {
    post('error', { message: err && err.message ? err.message : String(err) });
  }
};
