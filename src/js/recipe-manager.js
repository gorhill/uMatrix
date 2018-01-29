/*******************************************************************************

    uMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2018 Raymond Hill

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

/* global punycode */

'use strict';

/******************************************************************************/

µMatrix.recipeManager = (function() {
    let rawRecipes = [];
    let recipeIdGenerator = 1;
    let recipeBook = new Map();
    let reValidRecipeFile = /^! uMatrix: Ruleset recipes [0-9.]+\n/;
    let reNoUnicode = /^[\x00-\x7F]$/;

    var authorFromHeader = function(header) {
        let match = /^! +maintainer: +([^\n]+)/im.exec(header);
        return match !== null ? match[1].trim() : '';
    };

    var conditionMatch = function(condition, srcHostname, desHostnames) {
        let i = condition.indexOf(' ');
        if ( i === -1 ) { return false; }
        let hn = condition.slice(0, i).trim();
        if ( hn !== '*' && srcHostname.endsWith(hn) === false ) {
            return false;
        }
        hn = condition.slice(i + 1).trim();
        if ( hn === '*' ) { return true; }
        for ( let desHostname of desHostnames ) {
            if ( desHostname.endsWith(hn) ) { return true; }
        }
        return false;
    };

    var toASCII = function(rule) {
        if ( reNoUnicode.test(rule) ) { return rule; }
        let parts = rule.split(/\s+/);
        for ( let i = 0; i < parts.length; i++ ) {
            parts[i] = punycode.toASCII(parts[i]);
        }
        return parts.join(' ');
    };

    var compareLength = function(a, b) {
        return b.length - a.length;
    };

    var getTokens = function(s) {
        let tokens = s.match(/[a-z0-9]+/gi);
        if ( tokens === null ) { return []; }
        return tokens;
    };

    var addRecipe = function(recipe) {
        let tokens = getTokens(recipe.condition);
        tokens.sort(compareLength);
        let token = tokens[0];
        let recipes = recipeBook.get(token);
        if ( recipes === undefined ) {
            recipeBook.set(token, recipes = []);
        }
        recipes.push(recipe);
    };

    var fromString = function(raw) {
        var recipeName,
            recipeCondition,
            recipeRuleset;
        let rawHeader = raw.slice(0, 1024);
        if ( reValidRecipeFile.test(rawHeader) === false ) { return; }
        let maintainer = authorFromHeader(rawHeader);
        let lineIter = new µMatrix.LineIterator(raw);
        for (;;) {
            let line = lineIter.next().trim();
            if ( line.length === 0 ) {
                if (
                    recipeName !== undefined &&
                    recipeCondition !== undefined &&
                    recipeRuleset.length !== 0
                ) {
                    addRecipe({
                        id: recipeIdGenerator++,
                        name: recipeName,
                        maintainer: maintainer,
                        condition: recipeCondition,
                        ruleset: recipeRuleset
                    });
                }
                recipeName = undefined;
            }
            if ( lineIter.eot() && recipeName === undefined ) { break; }
            if ( line.length === 0 ) { continue; }
            let c = line.charCodeAt(0);
            if ( c === 0x23 /* '#' */ || c === 0x21 /* '!' */ ) { continue; }
            if ( recipeName === undefined ) {
                recipeName = line;
                recipeCondition = undefined;
                continue;
            }
            if ( recipeCondition === undefined ) {
                recipeCondition = toASCII(line);
                recipeRuleset = '';
                continue;
            }
            if ( recipeRuleset.length !== 0 ) {
                recipeRuleset += '\n';
            }
            recipeRuleset += toASCII(line);
        }
    };

    var fromPendingStrings = function() {
        if ( rawRecipes.length === 0 ) { return; }
        for ( var raw of rawRecipes ) {
            fromString(raw);
        }
        rawRecipes = [];
    };

    return {
        apply: function(details) {
            let µm = µMatrix;
            let tMatrix = µm.tMatrix;
            let pMatrix = µm.pMatrix;
            let mustPersist = false;
            for ( let rule of details.ruleset.split('\n') ) {
                let parts = rule.split(/\s+/);
                let action = tMatrix.evaluateCellZXY(parts[0], parts[1], parts[2]);
                if ( action === 1 ) {
                    tMatrix.whitelistCell(parts[0], parts[1], parts[2]);
                }
                if ( details.commit !== true ) { continue; }
                action = pMatrix.evaluateCellZXY(parts[0], parts[1], parts[2]);
                if ( action === 1 ) {
                    pMatrix.whitelistCell(parts[0], parts[1], parts[2]);
                    mustPersist = true;
                }
            }
            if ( mustPersist ) {
                µm.saveMatrix();
            }
        },
        fetch: function(srcHostname, desHostnames, callback) {
            fromPendingStrings();
            let out = [];
            let fetched = new Set();
            let tokens = getTokens(srcHostname + ' ' + desHostnames.join(' '));
            for ( let token of tokens ) {
                let recipes = recipeBook.get(token);
                if ( recipes === undefined ) { continue; }
                for ( let recipe of recipes ) {
                    if ( fetched.has(recipe.id) ) { continue; }
                    if (
                        conditionMatch(
                            recipe.condition,
                            srcHostname,
                            desHostnames
                        )
                    ) {
                        out.push(recipe);
                        fetched.add(recipe.id);
                    }
                }
            }
            callback(out);
        },
        commitStatuses: function(details) {
            let matrix = µMatrix.pMatrix;
            for ( let recipe of details.recipes ) {
                let ruleIter = new µMatrix.LineIterator(recipe.ruleset);
                while ( ruleIter.eot() === false ) {
                    let parts = ruleIter.next().split(/\s+/);
                    if (
                        matrix.evaluateCellZXY(
                            details.scope,
                            parts[1],
                            parts[2]
                        ) === 1
                    ) {
                        recipe.mustCommit = true;
                        break;
                    }
                }
            }
            return details;
        },
        fromString: function(raw) {
            rawRecipes.push(raw);
        },
        reset: function() {
            rawRecipes.length = 0;
            recipeBook.clear();
        }
    };
})();

/******************************************************************************/
