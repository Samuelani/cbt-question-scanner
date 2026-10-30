/*!
 * parser.js - CBT question parser (no dependencies, works offline)
 * Turns raw text (pasted, OCR, DOCX, PDF) into question objects, validates
 * them, and builds the exact JSON the XAMPP CBT portal imports.
 *
 * Browser:  <script src="parser.js"></script>  -> window.CBTParser
 * Node:     const CBTParser = require('./parser.js');
 *
 * PUBLIC API
 *   CBTParser.parse(text)            -> { questions, ignored, stats }
 *   CBTParser.validateQuestion(q)    -> [{ code, message }]   ([] = valid)
 *   CBTParser.validateAll(questions) -> { valid, total, needAttention, blocking }
 *   CBTParser.buildExport({class_name, subject_name, questions, now?})
 *                                    -> exact JSON object (throws if invalid)
 *   CBTParser.exportFileName(class_name, subject_name, now?)
 *   CBTParser.formatTimestamp(date)  -> "YYYY-MM-DD HH:MM:SS" (local time)
 *   CBTParser.newQuestion()          -> blank question for the "Add" button
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CBTParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LETTERS = ['A', 'B', 'C', 'D'];
  var uid = 0;

  function newQuestion(number) {
    uid += 1;
    return {
      id: 'q' + uid + '_' + Math.random().toString(36).slice(2, 7), // UI use only, never exported
      number: number == null ? null : number,                       // number in source paper, UI use only
      question_text: '',
      option_a: '', option_b: '', option_c: '', option_d: '',
      option_e: '',                                                  // only used to detect 5-option papers
      correct_option: '',
      issues: []
    };
  }

  // ---------- text cleanup ----------
  function cleanLine(s) {
    return String(s)
      .replace(/[\u200B-\u200D\uFEFF\f]/g, '')
      .replace(/[\u00A0\t]/g, ' ')
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/^[|\u2022\u25CF\u25CB\u25A0\u25A1\u25AA\u2023\u00B7]+\s*/, '') // OCR junk / bullets
      .replace(/\s+/g, ' ')
      .trim();
  }

  function joinText(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b; // "informa-" + "tion"
    return a + ' ' + b;
  }

  var NOISE = [
    /^page\s*\d+(\s*(of|\/)\s*\d+)?$/i,
    /^-+\s*\d+\s*-+$/,
    /^\d+\s+of\s+\d+$/i,
    /^[-_=~.*\s]{3,}$/
  ];
  // Lines that end the current question so headings are not glued onto option D
  var SEAL = [
    /^(section|part|paper)\s+[a-z0-9]+\b/i,
    /^instructions?\b/i,
    /^time\s*allowed/i,
    /^(answer|attempt)\s+(all|any)\b/i,
    /^(name|class|subject|date|candidate)\s*:/i,
    /^(theory|essay)\b/i
  ];

  var ANSWER_RE = /(?:^|\s)(?:answers?|ans|correct(?:\s+(?:answer|option))?)\s*[:=\-]\s*\(?([A-Da-d])\)?[.\s]*$/i;
  var KEY_HEADER_RE = /^(?:answer\s*key|answers|marking\s*scheme|key)\b\s*[:\-]?\s*(.*)$/i;
  var KEY_PAIR_RE = /(\d{1,3})\s*[.\-:)=]*\s*\(?([A-Da-d])\)?(?![a-z])/gi;

  // ---------- option splitting ----------
  // Finds "A. x B. y", "(a) x", "C) x" markers. Only an ascending A,B,C... chain counts.
  function splitOptions(text) {
    var re = /(^|\s)(?:\(([A-Ea-e])\)|([A-Ea-e])\)|([A-Ea-e])[.:](?=\s|$))/g;
    var ms = [], m;
    while ((m = re.exec(text))) {
      ms.push({
        letter: (m[2] || m[3] || m[4]).toUpperCase(),
        start: m.index + m[1].length,
        end: m.index + m[0].length
      });
    }
    if (!ms.length) return null;

    var s = -1, i;
    if (ms[0].start === 0) s = 0;                          // line begins with a marker
    else {
      for (i = 0; i < ms.length - 1; i++) {                // inline: needs A then B
        if (ms[i].letter === 'A' && ms[i + 1].letter === 'B') { s = i; break; }
      }
    }
    if (s < 0) return null;

    var chain = [ms[s]];
    for (i = s + 1; i < ms.length; i++) {
      if (ms[i].letter.charCodeAt(0) === chain[chain.length - 1].letter.charCodeAt(0) + 1) chain.push(ms[i]);
    }
    var opts = chain.map(function (c, k) {
      var next = chain[k + 1];
      return { letter: c.letter, text: text.slice(c.end, next ? next.start : text.length).trim() };
    });
    return { lead: text.slice(0, chain[0].start).trim(), opts: opts };
  }

  // ---------- question start detection ----------
  function matchQuestionStart(line) {
    var m = line.match(/^(?:question|qn|q)\s*\.?\s*(\d{1,3})\s*[.):\-]?\s*(.*)$/i);
    if (m) return { n: parseInt(m[1], 10), rest: m[2], prefixed: true };
    m = line.match(/^(\d{1,3})(?:\s*\)\s*|\s*\.\s+|\s*\.$|\s*:\s+|\s*-\s+)(.*)$/);
    if (m) return { n: parseInt(m[1], 10), rest: m[2], prefixed: false };
    return null;
  }

  function optionCount(q) {
    return LETTERS.filter(function (L) { return q['option_' + L.toLowerCase()]; }).length;
  }

  // ---------- validation ----------
  function validateQuestion(q) {
    var issues = [];
    if (!String(q.question_text || '').trim()) {
      issues.push({ code: 'empty_question', message: 'Question text is empty' });
    }
    LETTERS.forEach(function (L) {
      if (!String(q['option_' + L.toLowerCase()] || '').trim()) {
        issues.push({ code: 'missing_option_' + L.toLowerCase(), message: 'Option ' + L + ' is empty' });
      }
    });
    if (String(q.option_e || '').trim()) {
      issues.push({ code: 'extra_option', message: 'Has a 5th option (E). Only A-D are supported' });
    }
    var ans = String(q.correct_option || '').toUpperCase();
    if (!/^[A-D]$/.test(ans)) {
      issues.push({ code: 'no_answer', message: 'No correct answer selected' });
    } else if (!String(q['option_' + ans.toLowerCase()] || '').trim()) {
      issues.push({ code: 'answer_empty_option', message: 'Correct answer points to an empty option' });
    }
    return issues;
  }

  function validateAll(questions) {
    var blocking = [];
    questions.forEach(function (q, i) {
      var issues = validateQuestion(q);
      q.issues = issues;
      if (issues.length) blocking.push({ index: i, number: i + 1, id: q.id, issues: issues });
    });
    return {
      valid: questions.length > 0 && blocking.length === 0,
      total: questions.length,
      needAttention: blocking.length,
      blocking: blocking
    };
  }

  // ---------- main parser ----------
  function parse(text) {
    var lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
    var questions = [], ignored = [];
    var cur = null, lastLetter = null, lastNum = 0, keyMode = false, keyApplied = 0;
    var keyMap = [];

    function start(n) {
      cur = newQuestion(n);
      questions.push(cur);
      lastLetter = null;
      if (n != null) lastNum = n;
    }
    function append(t) {
      if (!t) return;
      if (!cur) { ignored.push(t); return; }
      if (lastLetter) {
        var k = 'option_' + lastLetter.toLowerCase();
        cur[k] = joinText(cur[k], t);
      } else cur.question_text = joinText(cur.question_text, t);
    }
    function setOption(letter, t) {
      if (!cur) { ignored.push(t); return; }
      var k = 'option_' + letter.toLowerCase();
      if (cur[k]) start(null); // same letter twice = a question number was probably missed; flag it
      cur[k] = t;
      lastLetter = letter;
    }
    function processText(t) {
      var sp = splitOptions(t);
      if (sp) {
        if (sp.lead) append(sp.lead);
        sp.opts.forEach(function (o) { setOption(o.letter, o.text); });
      } else append(t);
    }

    lines.forEach(function (raw) {
      var line = cleanLine(raw);
      if (!line) return;
      if (NOISE.some(function (r) { return r.test(line); })) return;

      // answer key section ("Answers: 1.C 2.A ..." or a header then pairs)
      if (!keyMode) {
        var kh = line.match(KEY_HEADER_RE);
        if (kh && (kh[1] === '' || /\d{1,3}\s*[.\-:)=]*\s*\(?[A-Da-d]\)?(?![a-z])/i.test(kh[1]))) {
          keyMode = true;
          line = kh[1];
          if (!line) return;
        }
      }
      if (keyMode) {
        var p;
        KEY_PAIR_RE.lastIndex = 0;
        while ((p = KEY_PAIR_RE.exec(line))) keyMap.push({ n: parseInt(p[1], 10), a: p[2].toUpperCase() });
        return;
      }

      // inline or standalone "Answer: C"
      var am = line.match(ANSWER_RE);
      if (am) {
        if (cur) cur.correct_option = am[1].toUpperCase();
        line = line.slice(0, am.index).trim();
        if (!line) return;
      }

      if (SEAL.some(function (r) { return r.test(line); }) && !matchQuestionStart(line)) {
        cur = null; lastLetter = null;
        return;
      }

      var qs = matchQuestionStart(line);
      if (qs) {
        var expected = lastNum + 1;
        var accept = !cur || qs.prefixed || qs.n === expected || optionCount(cur) >= 3;
        if (accept) {
          start(qs.n);
          if (qs.rest) processText(qs.rest);
          return;
        }
      }
      processText(line);
    });

    // apply answer key by source question number
    keyMap.forEach(function (k) {
      for (var i = 0; i < questions.length; i++) {
        if (questions[i].number === k.n && !questions[i].correct_option) {
          questions[i].correct_option = k.a; keyApplied += 1; break;
        }
      }
    });

    // final tidy
    questions.forEach(function (q) {
      ['question_text', 'option_a', 'option_b', 'option_c', 'option_d', 'option_e'].forEach(function (k) {
        q[k] = q[k].replace(/\s+/g, ' ').trim();
      });
    });
    var v = validateAll(questions);
    return {
      questions: questions,
      ignored: ignored.slice(0, 30),
      stats: { total: v.total, needAttention: v.needAttention, keyApplied: keyApplied }
    };
  }

  // ---------- export ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function formatTimestamp(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function buildExport(opts) {
    var cls = String(opts.class_name || '').trim();
    var sub = String(opts.subject_name || '').trim();
    var qs = opts.questions || [];
    var problems = [];
    if (!cls) problems.push('Class is not selected');
    if (!sub) problems.push('Subject is not selected');
    if (!qs.length) problems.push('There are no questions');
    var v = validateAll(qs);
    v.blocking.forEach(function (b) {
      problems.push('Question ' + b.number + ': ' + b.issues.map(function (i) { return i.message; }).join('; '));
    });
    if (problems.length) {
      var err = new Error('Export blocked: ' + problems.length + ' problem(s)');
      err.problems = problems;
      err.blocking = v.blocking;
      throw err;
    }
    return {
      class_name: cls,
      subject_name: sub,
      exported_at: formatTimestamp(opts.now),
      questions: qs.map(function (q) {
        return {
          question_text: q.question_text.trim(),
          option_a: q.option_a.trim(),
          option_b: q.option_b.trim(),
          option_c: q.option_c.trim(),
          option_d: q.option_d.trim(),
          correct_option: String(q.correct_option).toUpperCase()
        };
      })
    };
  }

  function exportFileName(cls, sub, now) {
    var d = now || new Date();
    var clean = function (s) { return String(s || '').replace(/[^A-Za-z0-9]+/g, ''); };
    return clean(cls) + '_' + clean(sub) + '_' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.json';
  }

  return {
    parse: parse,
    validateQuestion: validateQuestion,
    validateAll: validateAll,
    buildExport: buildExport,
    exportFileName: exportFileName,
    formatTimestamp: formatTimestamp,
    newQuestion: newQuestion
  };
});
