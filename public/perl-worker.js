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
console.debug = function () {};
importScripts(webperlUrl);
if (Array.isArray(Perl.stateChangeListeners)) {
  Perl.stateChangeListeners.length = 0;
}

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

/** Browser Perl has no TeX Live; latexdiff also redefines subs on each run. */
function stripBenignStderr(stderr) {
  return String(stderr || '')
    .split(/\r?\n/)
    .filter((line) => {
      const text = line.trim();
      if (!text) return false;
      if (/listings package not detected/i.test(text)) return false;
      if (/Disabling mark-up in verbatim/i.test(text)) return false;
      if (/Use of uninitialized value/i.test(text)) return false;
      if (/^Subroutine \S+ redefined at/i.test(text)) return false;
      if (/^Perl:/i.test(text)) return false;
      return true;
    })
    .join('\n')
    .trim();
}

function patchLatexdiffSource(source) {
  return source
    .replace(
      /defined\(\s*\$packages\{"listings"\}\s*\)\s+or\s+`kpsewhich listings\.sty`\s+ne\s+""/,
      'defined($packages{"listings"})',
    )
    .replace(
      /use warnings;/,
      "use warnings;\nno warnings qw(redefine prototype once);",
    )
    .replace(
      /^print \$diffall;/m,
      'open(my $__difffh, ">", "/diff.out") or die $!; binmode($__difffh, ":utf8"); print $__difffh $diffall; close $__difffh;',
    );
}

async function mountLatexdiff() {
  const res = await fetch(new URL('latexdiff-so', self.location.href));
  if (!res.ok) {
    throw new Error(`Failed to fetch latexdiff-so (${res.status})`);
  }
  const latexdiffCode = patchLatexdiffSource(await res.text());
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
      if (typeof FS !== 'undefined' && FS.writeFile) {
        FS.writeFile('/boot.pl', "1;\n");
        Perl.start(['/boot.pl']);
      } else {
        Perl.start(['-e', '1']);
      }
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

  console.log('[wasm] latexdiff input', {
    argv,
    oldTex: String(oldText ?? ''),
    newTex: String(newText ?? ''),
  });

  const capture = captureOutput();

  if (typeof FS !== 'undefined' && FS.writeFile) {
    try {
      FS.unlink('/diff.out');
    } catch {
      /* no previous output */
    }
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
      '$SIG{__WARN__} = sub {',
      '  my $msg = $_[0];',
      '  return if $msg =~ /redefined at/;',
      '  return if $msg =~ /Use of uninitialized value/;',
      '  return if $msg =~ /listings package not detected/;',
      '  return if $msg =~ /Disabling mark-up in verbatim/;',
      '  print STDERR $msg;',
      '};',
      'chdir "/";',
      "$0 = '/latexdiff.pl';",
      "open(DATA, '<', '/latexdiff.pl') or die \"Cannot open latexdiff-so: $!\";",
      "open(my $srcfh, '<', '/latexdiff.pl') or die $!;",
      'my $code = do { local $/; <$srcfh> };',
      'close $srcfh;',
      '$code =~ s/^__END__\\s*[\\r\\n].*//s;',
      "no warnings qw(redefine prototype once);",
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
  let output = stdout;
  if (typeof FS !== 'undefined' && FS.readFile) {
    try {
      output = FS.readFile('/diff.out', { encoding: 'utf8' });
    } catch {
      /* fall back to captured stdout */
    }
  }
  if (stderr && !String(output || '').trim()) {
    throw new Error(stderr);
  }
  if (!String(output || '').trim()) {
    throw new Error(stderr || 'latexdiff produced no output.');
  }

  const noPreamble = argv.includes('--no-preamble');
  if (!noPreamble && !String(output).includes('\\providecommand{\\DIFadd}')) {
    throw new Error(
      stderr || 'latexdiff did not insert preamble macros, so the result would not compile.',
    );
  }

  console.log('[wasm] latexdiff output', {
    argv,
    stdout: String(output ?? ''),
    stderr,
    rawStderr,
  });

  return { output, stderr };
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
