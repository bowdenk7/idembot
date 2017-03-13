/// <reference path="../types/github.d.ts" />

import GithubAPIClient from './client';
import { addAction } from './actionRunner';

import { Issue } from './github';

export type Logger = {};
export type OnChangeHandler = (item: Issue) => void;

export type ActionExecuteInfo = {
    client: GithubAPIClient,
    log: Logger
}

export interface IAction {
    summary: string;
    onChanged(handler: OnChangeHandler): void;
}

export interface IActionImplementation extends IAction {
    execute(info: ActionExecuteInfo): Promise<void>;
}

export abstract class BaseAction implements IActionImplementation {
    abstract get summary(): string;

    protected beforeChangeHandlers: OnChangeHandler[] = [];
    protected afterChangeHandlers: OnChangeHandler[] = [];
    onChanged(handler: OnChangeHandler) {
        this.afterChangeHandlers.push(handler);
    }
    onBeforeChange(handler: OnChangeHandler) {
        this.beforeChangeHandlers.push(handler);
    }

    protected async fireOnBeforeChange(issue: Issue) {
        for (const before of this.beforeChangeHandlers) {
            await before(issue);
        }
    }

    protected async fireOnChanged(issue: Issue) {
        for (const after of this.afterChangeHandlers) {
            await after(issue);
        }
    }

    public abstract async execute(info: ActionExecuteInfo): Promise<void>;
}

export namespace Labels {
    export abstract class Base extends BaseAction {
        constructor(public issue: Issue, public labels: string[]) {
            super();
        }

        protected async fireOnBeforeChange() {
            await super.fireOnBeforeChange(this.issue);
        }

        protected async fireOnChanged() {
            await super.fireOnChanged(this.issue);
        }
    }

    export class Add extends Base {
        get summary() {
            return `Add labels ${JSON.stringify(this.labels)} to issue ${this.issue.number}`;
        }

        async execute(info: ActionExecuteInfo) {
            const labelsToAdd = this.labels.filter(lab => !this.issue.hasLabel(lab));
            if (labelsToAdd.length === 0) return;
            await this.fireOnBeforeChange();
            await info.client.addLabels(this.issue, labelsToAdd);
            await this.fireOnChanged();
        }
    }

    export class Remove extends Base {
        get summary() {
            return `Remove labels ${JSON.stringify(this.labels)} to issue ${this.issue.number}`;
        }

        async execute(info: ActionExecuteInfo) {
            const labelsToRemove = this.labels.filter(lab => this.issue.hasLabel(lab));
            if (labelsToRemove.length === 0) return;
            await this.fireOnBeforeChange();
            await info.client.removeLabels(this.issue, labelsToRemove);
            await this.fireOnChanged();
        }
    }

    export class Set extends Base {
        get summary() {
            return `Apply label set ${JSON.stringify(this.labels)} to issue ${this.issue.number}`;
        }

        async execute(info: ActionExecuteInfo) {
            const desired = this.labels.slice().sort();
            const actual = this.issue.labels.map(l => l.name).sort();
            if (JSON.stringify(desired) === JSON.stringify(actual)) {
                return;
            }
            await this.fireOnBeforeChange();
            await info.client.setLabels(this.issue, this.labels);
            await this.fireOnChanged();
        }
    }
}

namespace Assignees {
    abstract class Base extends BaseAction {
        constructor(public issue: GitHubAPI.Issue, public assignees: string[]) {
            super();
        }
    }
    export class Add extends Base {
        get summary() {
            return `Assign issue ${this.issue.number} to ${JSON.stringify(this.assignees)}`;
        }

        async execute(info: ActionExecuteInfo) {
        }
    }
}
