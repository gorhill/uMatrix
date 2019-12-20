/*******************************************************************************

    uMatrix - a browser extension to block requests.
    Copyright (C) 2014-2018 Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uMatrix
*/

/* global diff_match_patch, CodeMirror, uDom */

'use strict';

/******************************************************************************/

{
// >>>>> start of local scope

/******************************************************************************/

// Move to dashboard-common.js if needed

{
    let timer;
    const resize = ( ) => {
        timer = undefined;
        const child = document.querySelector('.vfill-available');
        if ( child === null ) { return; }
        const prect = document.documentElement.getBoundingClientRect();
        const crect = child.getBoundingClientRect();
        const cssHeight = Math.max(prect.bottom - crect.top, 80) + 'px';
        if ( child.style.height !== cssHeight ) {
            child.style.height = cssHeight;
            if ( typeof mergeView !== 'undefined' ) {
                mergeView.leftOriginal().refresh();
                mergeView.editor().refresh();
            }
        }
    };
    const resizeAsync = function(delay) {
        if ( timer === undefined ) {
            timer = vAPI.setTimeout(
                resize,
                typeof delay === 'number' ? delay : 66
            );
        }
    };
    window.addEventListener('resize', resizeAsync);
    const observer = new MutationObserver(resizeAsync);
    observer.observe(document.querySelector('.body'), {
        childList: true,
        subtree: true
    });
    resizeAsync(1);
}

/******************************************************************************/

const mergeView = new CodeMirror.MergeView(
    document.querySelector('.codeMirrorMergeContainer'),
    {
        allowEditingOriginals: true,
        connect: 'align',
        inputStyle: 'contenteditable',
        lineNumbers: true,
        lineWrapping: false,
        origLeft: '',
        revertButtons: true,
        value: ''
    }
);
mergeView.editor().setOption('styleActiveLine', true);
mergeView.editor().setOption('lineNumbers', false);
mergeView.leftOriginal().setOption('readOnly', 'nocursor');

const unfilteredRules = {
    orig: { doc: mergeView.leftOriginal(), rules: [] },
    edit: { doc: mergeView.editor(), rules: [] }
};

let cleanEditToken = 0;
let cleanEditText = '';

let differ;

/******************************************************************************/

// Borrowed from...
// https://github.com/codemirror/CodeMirror/blob/3e1bb5fff682f8f6cbfaef0e56c61d62403d4798/addon/search/search.js#L22
// ... and modified as needed.

const updateOverlay = (function() {
    let reFilter;
    const mode = {
        token: function(stream) {
            if ( reFilter !== undefined ) {
                reFilter.lastIndex = stream.pos;
                const match = reFilter.exec(stream.string);
                if ( match !== null ) {
                    if ( match.index === stream.pos ) {
                        stream.pos += match[0].length || 1;
                        return 'searching';
                    }
                    stream.pos = match.index;
                    return;
                }
            }
            stream.skipToEnd();
        }
    };
    return function(filter) {
        reFilter = typeof filter === 'string' && filter !== '' ?
            new RegExp(filter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') :
            undefined;
        return mode;
    };
})();

/******************************************************************************/

// Incrementally update text in a CodeMirror editor for best user experience:
// - Scroll position preserved
// - Minimum amount of text updated

const rulesToDoc = function(clearHistory) {
    for ( const key in unfilteredRules ) {
        if ( unfilteredRules.hasOwnProperty(key) === false ) { continue; }
        const doc = unfilteredRules[key].doc;
        const rules = filterRules(key);
        if ( doc.lineCount() === 1 && doc.getValue() === '' || rules.length === 0 ) {
            doc.setValue(rules.length !== 0 ? rules.join('\n') : '');
            continue;
        }
        if ( differ === undefined ) { differ = new diff_match_patch(); }
        const beforeText = doc.getValue();
        const afterText = rules.join('\n');
        const diffs = differ.diff_main(beforeText, afterText);
        doc.startOperation();
        let i = diffs.length;
        let iedit = beforeText.length;
        while ( i-- ) {
            const diff = diffs[i];
            if ( diff[0] === 0 ) {
                iedit -= diff[1].length;
                continue;
            }
            const end = doc.posFromIndex(iedit);
            if ( diff[0] === 1 ) {
                doc.replaceRange(diff[1], end, end);
                continue;
            }
            /* diff[0] === -1 */
            iedit -= diff[1].length;
            const beg = doc.posFromIndex(iedit);
            doc.replaceRange('', beg, end);
        }
        doc.endOperation();
    }
    cleanEditText = mergeView.editor().getValue().trim();
    cleanEditToken = mergeView.editor().changeGeneration();
    if ( clearHistory ) {
        mergeView.editor().clearHistory();
    }
};

/******************************************************************************/

const filterRules = function(key) {
    const filter = uDom('#ruleFilter input').val();
    let rules = unfilteredRules[key].rules;
    if ( filter !== '' ) {
        rules = rules.slice();
        let i = rules.length;
        while ( i-- ) {
            if ( rules[i].indexOf(filter) === -1 ) {
                rules.splice(i, 1);
            }
        }
    }
    return rules;
};

/******************************************************************************/

const renderRules = function(details, firstVisit = false) {
    unfilteredRules.orig.rules = details.permanentRules.sort(directiveSort);
    unfilteredRules.edit.rules = details.temporaryRules.sort(directiveSort);
    rulesToDoc(firstVisit);
    if ( firstVisit ) {
        mergeView.editor().execCommand('goNextDiff');
    }
    onTextChanged(true);
};

// Switches before, rules after
const directiveSort = function(a, b) {
    const aIsSwitch = a.indexOf(': ') !== -1;
    const bIsSwitch = b.indexOf(': ') !== -1;
    if ( aIsSwitch === bIsSwitch ) {
        return a.localeCompare(b);
    }
    return aIsSwitch ? -1 : 1;
};

/******************************************************************************/

const applyDiff = function(permanent, toAdd, toRemove) {
    vAPI.messaging.send('dashboard', {
        what: 'modifyRuleset',
        permanent,
        toAdd,
        toRemove,
    }).then(response => {
        renderRules(response);
    });
};

/******************************************************************************/

// CodeMirror quirk: sometimes fromStart.ch and/or toStart.ch is undefined.
// When this happens, use 0.

mergeView.options.revertChunk = function(
    mv,
    from, fromStart, fromEnd,
    to, toStart, toEnd
) {
    // https://github.com/gorhill/uBlock/issues/3611
    if ( document.body.getAttribute('dir') === 'rtl' ) {
        let tmp;
        tmp = from; from = to; to = tmp;
        tmp = fromStart; fromStart = toStart; toStart = tmp;
        tmp = fromEnd; fromEnd = toEnd; toEnd = tmp;
    }
    if ( typeof fromStart.ch !== 'number' ) { fromStart.ch = 0; }
    if ( fromEnd.ch !== 0 ) { fromEnd.line += 1; }
    const toAdd = from.getRange(
        { line: fromStart.line, ch: 0 },
        { line: fromEnd.line, ch: 0 }
    );
    if ( typeof toStart.ch !== 'number' ) { toStart.ch = 0; }
    if ( toEnd.ch !== 0 ) { toEnd.line += 1; }
    const toRemove = to.getRange(
        { line: toStart.line, ch: 0 },
        { line: toEnd.line, ch: 0 }
    );
    applyDiff(from === mv.editor(), toAdd, toRemove);
};

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/757
// Support RequestPolicy rule syntax

const fromRequestPolicy = function(content) {
    const matches = /\[origins-to-destinations\]([^\[]+)/.exec(content);
    if ( matches === null || matches.length !== 2 ) { return; }
    return matches[1].trim()
                     .replace(/\|/g, ' ')
                     .replace(/\n/g, ' * allow\n');
};

/******************************************************************************/

// https://github.com/gorhill/uMatrix/issues/270

const fromNoScript = function(content) {
    let noscript = null;
    try {
        noscript = JSON.parse(content);
    } catch (e) {
    }
    if (
        noscript === null ||
        typeof noscript !== 'object' ||
        typeof noscript.prefs !== 'object' ||
        typeof noscript.prefs.clearClick === 'undefined' ||
        typeof noscript.whitelist !== 'string' ||
        typeof noscript.V !== 'string'
    ) {
        return;
    }
    const out = new Set();
    const reBad = /[a-z]+:\w*$/;
    const reURL = /[a-z]+:\/\/([0-9a-z.-]+)/;
    const directives = noscript.whitelist.split(/\s+/);
    let i = directives.length;
    while ( i-- ) {
        let directive = directives[i].trim();
        if ( directive === '' ) { continue; }
        if ( reBad.test(directive) ) { continue; }
        const matches = reURL.exec(directive);
        if ( matches !== null ) {
            directive = matches[1];
        }
        out.add('* ' + directive + ' * allow');
        out.add('* ' + directive + ' script allow');
        out.add('* ' + directive + ' frame allow');
    }
    return Array.from(out).join('\n');
};

/******************************************************************************/

const handleImportFilePicker = function() {
    const fileReaderOnLoadHandler = function() {
        if ( typeof this.result !== 'string' || this.result === '' ) {
            return;
        }
        let result = fromRequestPolicy(this.result);
        if ( result === undefined ) {
            result = fromNoScript(this.result);
            if ( result === undefined ) {
                result = this.result;
            }
        }
        if ( this.result === '' ) { return; }
        applyDiff(false, result, '');
    };
    const file = this.files[0];
    if ( file === undefined || file.name === '' ) { return; }
    if ( file.type.indexOf('text') !== 0 && file.type !== 'application/json') {
        return;
    }
    const fr = new FileReader();
    fr.onload = fileReaderOnLoadHandler;
    fr.readAsText(file);
};

/******************************************************************************/

const startImportFilePicker = function() {
    const input = document.getElementById('importFilePicker');
    // Reset to empty string, this will ensure an change event is properly
    // triggered if the user pick a file, even if it is the same as the last
    // one picked.
    input.value = '';
    input.click();
};

/******************************************************************************/

const exportUserRulesToFile = function() {
    vAPI.download({
        url: 'data:text/plain,' + encodeURIComponent(
            mergeView.leftOriginal().getValue().trim() + '\n'
        ),
        filename: uDom('[data-i18n="userRulesDefaultFileName"]').text()
    });
};

/******************************************************************************/

const onFilterChanged = (function() {
    let timer;
    let overlay = null;
    let last = '';

    const process = function() {
        timer = undefined;
        if ( mergeView.editor().isClean(cleanEditToken) === false ) { return; }
        const filter = uDom('#ruleFilter input').val();
        if ( filter === last ) { return; }
        last = filter;
        if ( overlay !== null ) {
            mergeView.leftOriginal().removeOverlay(overlay);
            mergeView.editor().removeOverlay(overlay);
            overlay = null;
        }
        if ( filter !== '' ) {
            overlay = updateOverlay(filter);
            mergeView.leftOriginal().addOverlay(overlay);
            mergeView.editor().addOverlay(overlay);
        }
        rulesToDoc(true);
    };

    return function() {
        if ( timer !== undefined ) { clearTimeout(timer); }
        timer = vAPI.setTimeout(process, 773);
    };
})();

/******************************************************************************/

const onTextChanged = (function() {
    let timer;

    const process = function(now) {
        timer = undefined;
        const diff = document.getElementById('diff');
        let isClean = mergeView.editor().isClean(cleanEditToken);
        if (
            now &&
            isClean === false &&
            mergeView.editor().getValue().trim() === cleanEditText
        ) {
            cleanEditToken = mergeView.editor().changeGeneration();
            isClean = true;
        }
        diff.classList.toggle('editing', isClean === false);
        diff.classList.toggle('dirty', mergeView.leftChunks().length !== 0);
        const input = document.querySelector('#ruleFilter input');
        if ( isClean ) {
            input.removeAttribute('disabled');
            CodeMirror.commands.save = undefined;
        } else {
            input.setAttribute('disabled', '');
            CodeMirror.commands.save = editSaveHandler;
        }
    };

    return function(now) {
        if ( timer !== undefined ) { clearTimeout(timer); }
        timer = now ? process(now) : vAPI.setTimeout(process, 57);
    };
})();

/******************************************************************************/

const revertAllHandler = function() {
    const toAdd = [], toRemove = [];
    const left = mergeView.leftOriginal();
    const edit = mergeView.editor();
    for ( const chunk of mergeView.leftChunks() ) {
        const addedLines = left.getRange(
            { line: chunk.origFrom, ch: 0 },
            { line: chunk.origTo, ch: 0 }
        );
        const removedLines = edit.getRange(
            { line: chunk.editFrom, ch: 0 },
            { line: chunk.editTo, ch: 0 }
        );
        toAdd.push(addedLines.trim());
        toRemove.push(removedLines.trim());
    }
    applyDiff(false, toAdd.join('\n'), toRemove.join('\n'));
};

/******************************************************************************/

const commitAllHandler = function() {
    const toAdd = [], toRemove = [];
    const left = mergeView.leftOriginal();
    const edit = mergeView.editor();
    for ( const chunk of mergeView.leftChunks() ) {
        const addedLines = edit.getRange(
            { line: chunk.editFrom, ch: 0 },
            { line: chunk.editTo, ch: 0 }
        );
        const removedLines = left.getRange(
            { line: chunk.origFrom, ch: 0 },
            { line: chunk.origTo, ch: 0 }
        );
        toAdd.push(addedLines.trim());
        toRemove.push(removedLines.trim());
    }
    applyDiff(true, toAdd.join('\n'), toRemove.join('\n'));
};

/******************************************************************************/

const editSaveHandler = function() {
    const editor = mergeView.editor();
    const editText = editor.getValue().trim();
    if ( editText === cleanEditText ) {
        onTextChanged(true);
        return;
    }
    if ( differ === undefined ) { differ = new diff_match_patch(); }
    const toAdd = [], toRemove = [];
    const diffs = differ.diff_main(cleanEditText, editText);
    for ( const diff of diffs ) {
        if ( diff[0] === 1 ) {
            toAdd.push(diff[1]);
        } else if ( diff[0] === -1 ) {
            toRemove.push(diff[1]);
        }
    }
    applyDiff(false, toAdd.join(''), toRemove.join(''));
};

/******************************************************************************/

self.cloud.onPush = function() {
    return mergeView.leftOriginal().getValue().trim();
};

self.cloud.onPull = function(data, append) {
    if ( typeof data !== 'string' ) { return; }
    applyDiff(
        false,
        data,
        append ? '' : mergeView.editor().getValue().trim()
    );
};

/******************************************************************************/

// Handle user interaction
uDom('#exportButton').on('click', exportUserRulesToFile);
uDom('#revertButton').on('click', revertAllHandler);
uDom('#commitButton').on('click', commitAllHandler);
uDom('#importButton').on('click', startImportFilePicker);
uDom('#importFilePicker').on('change', handleImportFilePicker);
uDom('#editSaveButton').on('click', editSaveHandler);
uDom('#ruleFilter input').on('input', onFilterChanged);

// https://groups.google.com/forum/#!topic/codemirror/UQkTrt078Vs
mergeView.editor().on('updateDiff', function() { onTextChanged(); });

vAPI.messaging.send('dashboard', {
    what: 'getRuleset',
}).then(response => {
    renderRules(response, true);
});

/******************************************************************************/

// <<<<< end of local scope
}

