/* estudy 判题引擎（JS 版）—— 与 app/engine.py 逐条对齐的移植。
 *
 * 为什么要有这一份：手机版是单个离线 HTML，没有 Python 运行时，
 * 判分必须在浏览器里自己算。为了不让两边给出不同结论，这里的每个分支
 * 都照抄 engine.py 的顺序和命名，并用 tools/test_mobile_parity.py 逐空对拍。
 *
 * 用法：
 *   var E = EstudyEngine.create(window.ESTUDY_DATA);
 *   E.judge('aple', 'apple', {}, {})
 */
(function (global) {
  'use strict';

  var PUNCT = '.,!?;:\"“”()[]{}';

  function create(data) {
    data = data || {};
    var IRREGULAR = data.IRREGULAR || {};
    var FUNC = data.FUNC || {};
    var PRON_CASE = data.PRON_CASE || {};
    var NOUNS = {};
    (data.NOUNS || []).forEach(function (n) { NOUNS[n] = true; });
    var DICT = data.DICT || {};

    // ---------------------------------------------------------------- 基础
    function normalize(s) {
      if (s === null || s === undefined) s = '';
      s = String(s);
      s = s.replace(/[’‘`']/g, '');
      var out = '';
      for (var i = 0; i < s.length; i++) {
        if (PUNCT.indexOf(s[i]) < 0) out += s[i];
      }
      out = out.split(/\s+/).filter(function (x) { return x.length; }).join(' ');
      return out.trim().toLowerCase();
    }

    function sameWord(a, b) {
      var na = normalize(a);
      return na === normalize(b) && na !== '';
    }

    function lev(a, b) {
      a = normalize(a); b = normalize(b);
      if (a === b) return 0;
      if (!a) return b.length;
      if (!b) return a.length;
      var prev = [];
      for (var j = 0; j <= b.length; j++) prev.push(j);
      for (var i = 1; i <= a.length; i++) {
        var cur = [i];
        for (var k = 1; k <= b.length; k++) {
          var cost = a[i - 1] === b[k - 1] ? 0 : 1;
          cur.push(Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + cost));
        }
        prev = cur;
      }
      return prev[b.length];
    }

    function diffChars(target, input) {
      var a = normalize(target), b = normalize(input);
      var n = a.length, m = b.length;
      var dp = [], back = [];
      for (var i = 0; i <= n; i++) {
        dp.push([]); back.push([]);
        for (var j = 0; j <= m; j++) { dp[i].push(0); back[i].push(''); }
      }
      for (i = 1; i <= n; i++) { dp[i][0] = i; back[i][0] = 'del'; }
      for (j = 1; j <= m; j++) { dp[0][j] = j; back[0][j] = 'ins'; }
      for (i = 1; i <= n; i++) {
        for (j = 1; j <= m; j++) {
          var cost = a[i - 1] === b[j - 1] ? 0 : 1;
          var d = dp[i - 1][j - 1] + cost;
          var u = dp[i - 1][j] + 1;
          var l = dp[i][j - 1] + 1;
          if (d <= u && d <= l) { dp[i][j] = d; back[i][j] = cost === 0 ? 'ok' : 'sub'; }
          else if (u <= l) { dp[i][j] = u; back[i][j] = 'del'; }
          else { dp[i][j] = l; back[i][j] = 'ins'; }
        }
      }
      var marks = [];
      for (i = 0; i < n; i++) marks.push(false);
      i = n; j = m;
      while (i > 0 || j > 0) {
        var op = back[i][j];
        if (op === 'ok' || op === 'sub') { marks[i - 1] = (op === 'ok'); i--; j--; }
        else if (op === 'del') { marks[i - 1] = false; i--; }
        else { j--; }
      }
      return marks;
    }

    // ---------------------------------------------------------------- 词形
    function formInfo(word) {
      var w = normalize(word);
      if (!w) return null;
      if (Object.prototype.hasOwnProperty.call(IRREGULAR, w)) {
        return { base: w, form: '原形' };
      }
      for (var base in IRREGULAR) {
        if (!Object.prototype.hasOwnProperty.call(IRREGULAR, base)) continue;
        var forms = IRREGULAR[base];
        if (Object.prototype.hasOwnProperty.call(forms, w)) {
          return { base: base, form: forms[w] };
        }
      }
      if (w.slice(-3) === 'ies') return { base: w.slice(0, -3) + 'y', form: '第三人称单数' };
      if (w.slice(-3) === 'ied') return { base: w.slice(0, -3) + 'y', form: '过去式/过去分词' };
      if (w.slice(-3) === 'ing') return { base: w.slice(0, -3), form: '现在分词/动名词' };
      if (w.slice(-2) === 'ed') return { base: w.slice(0, -2), form: '过去式/过去分词' };
      if (w.slice(-2) === 'es') return { base: w.slice(0, -2), form: '第三人称单数/复数' };
      if (w.slice(-1) === 's' && w.length > 2) return { base: w.slice(0, -1), form: '第三人称单数/复数' };
      return { base: w, form: '原形' };
    }

    function dedouble(base) {
      if (base.length >= 2 && base[base.length - 1] === base[base.length - 2]
        && 'bdglmnprt'.indexOf(base[base.length - 1]) >= 0) {
        return base.slice(0, -1);
      }
      return base;
    }

    function candidateBases(word) {
      var w = normalize(word);
      var info = formInfo(w);
      if (!info) return [];
      var bases = [info.base];
      if (info.base !== w) bases.push(info.base + 'e');
      return bases;
    }

    function stemKeys(word) {
      var keys = {};
      candidateBases(word).forEach(function (b) {
        [b, dedouble(b)].forEach(function (k) {
          if (k.length >= 3 || Object.prototype.hasOwnProperty.call(IRREGULAR, k)) {
            keys[k] = true;
          }
        });
      });
      return keys;
    }

    function sameStem(a, b) {
      var ka = stemKeys(a), kb = stemKeys(b);
      for (var k in ka) {
        if (Object.prototype.hasOwnProperty.call(ka, k) && kb[k]) return true;
      }
      return false;
    }

    // ---------------------------------------------------------------- 词典
    var CAT_NAME = { art: '冠词', prep: '介词', be: 'be 动词', aux: '助动词',
                     modal: '情态动词', pron: '代词' };
    function catName(c) { return CAT_NAME[c] || '功能词'; }

    function lookupMeaning(word) {
      var lst = DICT[normalize(word)];
      if (!lst || !lst.length) return null;
      for (var i = 0; i < lst.length; i++) {
        if (lst[i].indexOf('出现在') !== 0) return lst[i];
      }
      return lst[0];
    }

    // ---------------------------------------------------------------- 判分
    function judge(raw, target, slot, ctx) {
      slot = slot || {};
      ctx = ctx || {};
      var input = (raw === null || raw === undefined) ? '' : String(raw).trim();
      var n = normalize(input), nt = normalize(target);

      if (!n) return { status: 'empty', kind: '', title: '还没填', detail: '' };

      if (n === nt) {
        var tip = '';
        var t0 = target.slice(0, 1), i0 = input.slice(0, 1);
        if (/[A-Za-z]/.test(t0) && t0 === t0.toUpperCase() && t0 !== t0.toLowerCase()
          && /[A-Za-z]/.test(i0) && i0 === i0.toLowerCase() && i0 !== i0.toUpperCase()) {
          tip = '注意：' + target + ' 是专有名词或句首，首字母要大写。';
        }
        return { status: 'ok', kind: '', title: '正确', detail: tip, tip: tip };
      }

      if (slot.alt && slot.alt.some(function (a) { return normalize(a) === n; })) {
        return { status: 'ok', kind: '', title: '正确',
                 detail: '（' + input + ' 是这个空的另一种正确写法）' };
      }

      if (slot.warn && slot.warn.some(function (a) { return normalize(a) === n; })) {
        return { status: 'warn', kind: '地道性',
                 title: '能用，但本句更常用 ' + target,
                 detail: '你填的 ' + input + ' 语法上没问题，只是这句话习惯上用 ' + target + '。' };
      }

      var conf = slot.conf || {};
      for (var cw in conf) {
        if (Object.prototype.hasOwnProperty.call(conf, cw) && normalize(cw) === n) {
          return { status: 'bad', kind: '用词错误', title: '用词错误 →' + target,
                   detail: conf[cw] };
        }
      }

      var fIn = FUNC[n], fTar = FUNC[nt];
      if (fIn || fTar) {
        if (fIn && fTar && fIn.cat === fTar.cat) {
          var cat = fTar.cat, detail;
          if (cat === 'art') {
            var why;
            if (nt === 'a') why = 'a 用在辅音音素开头的词前面';
            else if (nt === 'an') why = 'an 用在元音音素开头的词前面';
            else why = 'the 表示特指双方都知道的人或物';
            detail = '冠词用错了。这里要用 ' + target + '（' + why + '）。';
          } else if (cat === 'prep') {
            detail = '介词搭配错了，这里要用 ' + target + '。';
            if (fTar.g) detail += fTar.g + '。';
          } else if (cat === 'be') {
            detail = 'be 动词形式错了，这里要用 ' + target + '（由主语的人称和句子的时态决定）。';
          } else if (cat === 'aux') {
            detail = '助动词用错了，这里要用 ' + target + '（它决定句子的时态或否定）。';
          } else if (cat === 'modal') {
            detail = '情态动词用错了，这里要用 ' + target + '。';
          } else {
            var c1 = PRON_CASE[nt] || '这种形式';
            var c2 = PRON_CASE[n] || '这种形式';
            detail = '代词形式错了。这里要用 ' + target + '（' + c1 + '），你填的 '
              + input + ' 是' + c2 + '。';
          }
          if (slot.g) detail += '\n' + slot.g;
          return { status: 'bad', kind: '语法错误',
                   title: '语法错误（' + catName(cat) + '）→' + target, detail: detail };
        }
        if (fTar && !fIn) {
          return { status: 'bad', kind: '语法错误',
                   title: '这里缺一个' + catName(fTar.cat) + ' →' + target,
                   detail: '这个空要填的是' + catName(fTar.cat) + ' ' + target
                     + '，不是 ' + input + '。' + (slot.g ? ('\n' + slot.g) : '') };
        }
      }

      if (sameStem(n, nt)) {
        var fi = formInfo(input), ft = formInfo(target), why2 = '';
        if (nt.slice(-2) === 'ed' || nt.slice(-3) === 'ied') {
          why2 = '这里要用' + (ft ? ft.form : '过去式/过去分词') + '。';
        } else if (nt.slice(-3) === 'ing') {
          why2 = '这里要用' + (ft ? ft.form : '动名词/现在分词') + '。';
        } else if (nt.slice(-1) === 's' && NOUNS[nt]) {
          why2 = '这里要用复数形式。';
        } else if (nt.slice(-1) === 's') {
          why2 = '主语或句子结构要求这里用这个形式。';
        }
        var d2 = '词形不对：你填的 ' + input + ' 是 ' + (fi ? fi.form : '另一种形式')
          + '，这个空需要 ' + target
          + ((ft && fi) ? ('（' + ft.form + '）') : '') + '。' + why2;
        if (slot.g) d2 += '\n' + slot.g;
        return { status: 'bad', kind: '语法错误', title: '语法错误（词形）→' + target,
                 detail: d2 };
      }

      var meaning = lookupMeaning(input);
      if (meaning) {
        var d3 = '用词错误：你填的 ' + input + ' 是“' + meaning
          + '”，和这个空要表达的意思不符，正确用词是 ' + target + '。';
        if (slot.g) d3 += '\n' + slot.g;
        var sib = ctx.siblings || [];
        if (sib.some(function (w) { return normalize(w) === n; })) {
          d3 += '\n（提示：' + input + ' 在这句话的另一个空里。）';
        }
        return { status: 'bad', kind: '用词错误', title: '用词错误 →' + target, detail: d3 };
      }

      var dist = lev(n, nt);
      var limit = nt.length <= 4 ? 1 : (nt.length <= 8 ? 2 : 3);
      if (dist > 0 && dist <= limit && nt.length > 2) {
        var d4 = '拼写错误：正确写法是 ' + target + '。';
        if (slot.g) d4 += '\n' + slot.g;
        return { status: 'bad', kind: '拼写错误', title: '拼写错误 →' + target, detail: d4,
                 diff: diffChars(target, input), diffWord: target };
      }

      var d5 = '这里应该填 ' + target + '。';
      if (slot.g) d5 += '\n' + slot.g;
      return { status: 'bad', kind: '拼写错误', title: '不对 →' + target, detail: d5,
               diff: diffChars(target, input), diffWord: target };
    }

    function slotOf(sentence, i) {
      return {
        g: (sentence.g || {})[String(i)],
        conf: (sentence.conf || {})[String(i)],
        warn: (sentence.warn || {})[String(i)],
        alt: (sentence.alt || {})[String(i)]
      };
    }

    function tokenize(text) {
      if (text === null || text === undefined) text = '';
      var out = '';
      for (var i = 0; i < String(text).length; i++) {
        var ch = String(text)[i];
        out += (PUNCT.indexOf(ch) >= 0 ? ' ' : ch);
      }
      return out.split(/\s+/).filter(function (w) { return w.length; });
    }

    function sentenceDisplay(sentence) {
      var toks = (sentence.t || []).slice();
      var punct = sentence.punct || {};
      var out = [];
      for (var i = 0; i < toks.length; i++) {
        out.push(toks[i]);
        var mark = punct[String(i)];
        if (mark) out.push(mark);
      }
      var text = out.join(' ')
        .replace(/\s+([,.;:!?%\)\]\}”’])/g, '$1')
        .replace(/([\(\[\{“‘])\s+/g, '$1');
      return text + (sentence.punc || '');
    }

    return {
      normalize: normalize, sameWord: sameWord, lev: lev, diffChars: diffChars,
      formInfo: formInfo, sameStem: sameStem, stemKeys: stemKeys,
      lookupMeaning: lookupMeaning, judge: judge, slotOf: slotOf,
      tokenize: tokenize, sentenceDisplay: sentenceDisplay, catName: catName
    };
  }

  global.EstudyEngine = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
