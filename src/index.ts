/// <reference path="github-api.ts" />

import * as Actions from './action';
import APIClient from './client';
import { runActions } from  './actionRunner';
import { SetupOptions, CommandLineOptions } from './options';

export { User, Issue, Milestone, Label } from './github';

async function run(opts: SetupOptions & CommandLineOptions, oauthToken: string) {
    if (opts === null) {
        console.log(`Call 'setup' from your rules.js module first`);
        return;
    }
    
    const c = new APIClient(oauthToken);
    const ruleNames = Object.keys(opts.rules);
    const info: Actions.ActionExecuteInfo = {
        client: c,
        log: {}
    };
    for (const repo of opts.repos) {
        console.log(`Running ${Object.keys(opts.rules).length} rules on ${repo.owner}/${repo.name}`);

        console.log('Fetching repo activity');
        const issueResults = await c.fetchChangedIssues(repo);
        for (const issue of issueResults.issues) {
            for (const ruleName of ruleNames) {
                const rule = opts.rules[ruleName];
                console.log(`Inovking rule ${ruleName}`);
                const result = rule(issue);
                if (result !== undefined) {
                    await result;
                }
                console.log('... done');
            }

            await runActions(info, opts);
        }
    }
}

export { 
    Actions,
    run,
    SetupOptions
};
