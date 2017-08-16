import https = require('https');

import { Issue, PullRequest, parseBasicRepoReference } from './github';
import * as api from './github-api';
import { Query } from './options';
import * as Wrapped from './github';
import path from './build-path';

export type IssuePageFetchResult = {
    issues: api.Issue[];
    fetchMore?: () => Promise<IssuePageFetchResult>;
}

let oauthToken: string;

export function initialize(_oauthToken: string) {
    oauthToken = _oauthToken;
}

let me: string | undefined;
export async function getMyLogin(): Promise<string> {
    if (me === undefined) {
        me = (JSON.parse(await exec('GET', '/user')) as api.User).login;
    }
    return me;
}

export async function addLabels(issue: Wrapped.Issue, labels: string[]) {
    // https://developer.github.com/v3/issues/labels/#add-labels-to-an-issue
    const body = JSON.stringify(labels);
    await exec(
        "POST",
        path('repos', issue.repository.owner, issue.repository.name, 'issues', issue.number, 'labels'),
        { body }
    );
}

export async function removeLabels(issue: Wrapped.Issue, labels: string[]) {
    // https://developer.github.com/v3/issues/labels/#remove-a-label-from-an-issue
    for (const label of labels) {
        await exec(
            "DELETE",
            path('repos', issue.repository.owner, issue.repository.name, 'issues', issue.number, 'labels', label)
        );
    }
}

export async function setLabels(issue: Wrapped.Issue, labels: string[]) {
    // https://developer.github.com/v3/issues/labels/#replace-all-labels-for-an-issue
    const body = JSON.stringify(labels);
    await exec(
        "PUT",
        path('repos', issue.repository.owner, issue.repository.name, 'issues', issue.number, 'labels'),
        { body }
    );
}

export async function lockIssue(issue: Wrapped.Issue) {
    await exec('PUT',
        path('repos', issue.repository.owner, issue.repository.name, 'issues', issue.number, 'lock'),
        { body: "" }
    );
}

export async function unlockIssue(issue: Wrapped.Issue) {
    await exec('DELETE',
        path('repos', issue.repository.owner, issue.repository.name, 'issues', issue.number, 'lock')
    );
}

export async function closeIssue(issue: Wrapped.Issue) {
    const body = JSON.stringify({ state: 'closed' });
    await exec('PATCH',
        path('repos', issue.repository.owner, issue.repository.name, 'issues', issue.number),
        { body }
    );
}

export async function reopenIssue(issue: Wrapped.Issue) {
    const body = JSON.stringify({ state: 'open' });
    await exec('PATCH',
        path('repos', issue.repository.owner, issue.repository.name, 'issues', issue.number),
        { body }
    );
}

export async function addComment(issue: Wrapped.Issue, body: string) {
    await exec('POST',
        path('repos', issue.repository.owner, issue.repository.name, 'issues', issue.number, 'comments'),
        { body: JSON.stringify({ body }) }
    );
}

export async function editComment(comment: Wrapped.IssueComment, body: string) {
    await exec('PATCH',
        path('repos', comment.repository.owner, comment.repository.name, 'issues', 'comments', comment.id),
        { body: JSON.stringify({ body }) }
    );
}

export type IssuePageResult = {
    page: api.Issue[];
    next?(): Promise<IssuePageResult>;
};

export async function fetchAllIssuesAndPRsRaw(repo: api.RepoReference) {
    return fetchPage(1);
    async function fetchPage(page: number): Promise<IssuePageResult> {
        // https://developer.github.com/v3/issues/#list-issues
        const queryString: any = {
            sort: 'created',
            filter: 'all',
            direction: 'asc',
            per_page: 100,
            page
        };

        const thisPage: api.Issue[] = JSON.parse(await exec('GET',
            path('repos', repo.owner, repo.name, 'issues'),
            { queryString }));

        return {
            page: thisPage,
            next: thisPage.length === 100 ? (() => fetchPage(page + 1)) : undefined
        };
    }
}

export async function fetchChangedIssuesRaw(repo: api.RepoReference) {
    // https://developer.github.com/v3/issues/#list-issues
    const queryString: any = {
        sort: 'updated',
        filter: 'all',
        direction: 'desc',
        per_page: 100
    };

    let page: api.Issue[] = JSON.parse(await exec('GET',
        path('repos', repo.owner, repo.name, 'issues'),
        { queryString }));
    page = page.filter(i => !i.pull_request);
    return page;
}

export async function runQuery(q: Query, callback: (item: PullRequest | Issue) => Promise<void>): Promise<void> {
    if (q.kind === "prs") {
        // https://developer.github.com/v3/pulls/#list-pull-requests
        let count = 0;
        let pageNumber = 1;
        const repo = parseBasicRepoReference(q.repo);
        while (true) {
            const queryString: any = {
                sort: q.sort,
                state: q.state,
                direction: q.direction,
                per_page: 100,
                page: pageNumber
            };

            const ref = parseBasicRepoReference(q.repo);
            const page: api.PullRequestFromList[] = JSON.parse(await exec('GET',
                path('repos', ref.owner, ref.name, 'pulls'),
                { queryString }));
            for (const item of page) {
                const pr = await PullRequest.fromReference(repo, item.number);
                await callback(pr);
                count++;
                if (count === q.count) return;
            }
            // Exhausted the query
            if (page.length < 100) return;
            pageNumber++;
        }
    } else {
        throw new Error("Other query kinds NYI");
    }
}


export async function fetchChangedPRsRaw(repo: api.RepoReference): Promise<api.PullRequestFromList[]> {
    // https://developer.github.com/v3/pulls/#list-pull-requests
    const queryString: any = {
        sort: 'updated',
        state: 'all',
        direction: 'desc',
        per_page: 100
    };

    const page: api.PullRequestFromList[] = JSON.parse(await exec('GET',
        path('repos', repo.owner, repo.name, 'pulls'),
        { queryString }));
    return page;
}

const ProjectsPreview = "application/vnd.github.inertia-preview+json"

export async function fetchProjectColumns(projectId: number): Promise<api.ProjectColumn[]> {
    const raw = await exec('GET', path('projects', projectId, 'columns'), { preview: ProjectsPreview });
    return JSON.parse(raw) as api.ProjectColumn[];
}

export async function fetchProjectColumnCards(columnId: number): Promise<api.ProjectColumnCard[]> {
    const raw = await exec('GET', path('projects', 'columns', columnId, 'cards'), { preview: ProjectsPreview });
    return JSON.parse(raw) as api.ProjectColumnCard[];
}

export async function createProjectCard(columnId: number, issue: Wrapped.IssueOrPullRequest): Promise<void> {
    const body = JSON.stringify({ content_id: issue.id, content_type: 'Issue' });
    await exec('POST', path('projects', 'columns', columnId, 'cards'),
        {
            preview: ProjectsPreview,
            body
        }
    );
}

export async function moveProjectCard(card: Wrapped.ProjectCard, targetColumn: Wrapped.ProjectColumn): Promise<void> {
    await exec('POST', path('projects', 'columns', 'cards', card.id, 'moves'),
        {
            preview: ProjectsPreview,
            body: JSON.stringify({
                position: 'bottom',
                column_id: targetColumn.columnId
            })
        }
    );
}

export async function deleteProjectCard(card: Wrapped.ProjectCard): Promise<void> {
    await exec('DELETE', path('projects', 'columns', 'cards', card.id),
        {
            preview: ProjectsPreview
        }
    );
}


export async function fetchIssueComments(issue: Wrapped.Issue): Promise<api.IssueComment[]> {
    const raw = await execPaged(path('repos', issue.repository.owner, issue.repository.name, 'issues', issue.number, 'comments'));
    return raw as api.IssueComment[];
}

export async function fetchPRCommits(issue: Wrapped.PullRequest): Promise<api.PullRequestCommit[]> {
    const raw = await execPaged(path('repos', issue.repository.owner, issue.repository.name, 'pulls', issue.number, 'commits'));
    return raw as api.PullRequestCommit[];
}

export async function fetchPRFiles(issue: Wrapped.PullRequest): Promise<api.PullRequestFile[]> {
    const raw = await execPaged(path('repos', issue.repository.owner, issue.repository.name, 'pulls', issue.number, 'files'));
    return raw as api.PullRequestFile[];
}

export async function fetchIssueCommentReactions(repo: api.RepoReference, commentId: number): Promise<api.Reaction[]> {
    // https://developer.github.com/v3/reactions/#list-reactions-for-an-issue-comment
    // GET /repos/:owner/:repo/issues/comments/:id/reactions
    const result = JSON.parse(await exec('GET', path('repos', repo.owner, repo.name, 'issues', 'comments', commentId, 'reactions')));
    console.log(result);
    return result;
}

export async function fetchPR(repo: api.RepoReference, number: number | string): Promise<api.PullRequest> {
    const result = JSON.parse(await exec('GET', path('repos', repo.owner, repo.name, 'pulls', number)));
    return result;
}

export async function fetchIssue(repo: api.RepoReference, number: number | string): Promise<api.Issue> {
    const result = JSON.parse(await exec('GET', path('repos', repo.owner, repo.name, 'issues', number)));
    return result;
}

export async function fetchPRReviews(repo: api.RepoReference, number: number): Promise<api.PullRequestReview[]> {
    // https://developer.github.com/v3/pulls/reviews/#list-reviews-on-a-pull-request
    // GET /repos/:owner/:repo/pulls/:number/reviews
    const result = JSON.parse(await exec('GET', path('repos', repo.owner, repo.name, 'pulls', number, 'reviews'), { preview: "application/vnd.github.black-cat-preview+json" }));
    return result as api.PullRequestReview[];
}

export async function fetchRefStatusSummary(repo: api.RepoReference, ref: string): Promise<api.CombinedStatus> {
    // https://developer.github.com/v3/repos/statuses/#get-the-combined-status-for-a-specific-ref
    // GET /repos/:owner/:repo/commits/:ref/status
    const result = JSON.parse(await exec('GET', path('repos', repo.owner, repo.name, 'commits', ref, 'status')));
    return result as api.CombinedStatus;
}

async function execPaged(path: string, perPage: number = 100, queryString: { [key: string]: string } = {}): Promise<{}[]> {
    const result: {}[] = [];
    var pageNumber = 1;
    while (true) {
        console.log(`Fetch page ${pageNumber}...`);
        const qs = { ...queryString, page: pageNumber.toString(), per_page: perPage.toString() };
        const page = await exec('GET', path, { queryString: qs });
        const arr = JSON.parse(page);
        if (!Array.isArray(arr)) {
            throw new Error("Didn't parse an array from a paged fetch");
        }
        result.push(...arr);
        if (arr.length < perPage) {
            return result;
        }
        pageNumber++;
    }
}


export interface ExecOptions {
    queryString?: { [key: string]: string };
    body?: string;
    preview?: string;
}

var lastRateLimit = 5000;
var lastRateLimitRemaining = 5000;
export async function exec(method: string, path: string, opts?: ExecOptions): Promise<string> {
    opts = opts || {};

    const hostname = "api.github.com";
    const headers: any = {
        "User-Agent": "RyanCavanaugh idembot",
        "Accept": opts.preview || "application/vnd.github.squirrel-girl-preview+json",
        "Authorization": `token ${oauthToken}`
    };

    const bodyStream = opts.body === undefined ? undefined : Buffer.from(opts.body);
    if (bodyStream !== undefined) {
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = bodyStream.length;
    }

    let fullPath = path;
    if (opts.queryString && Object.keys(opts.queryString).length > 0) {
        fullPath = fullPath + '?' + Object.keys(opts.queryString).map(k => k + '=' + encodeURIComponent(opts!.queryString![k])).join('&');
    }

    console.log(`[${lastRateLimitRemaining} / ${lastRateLimit}] HTTPS: ${method} https://${hostname}${fullPath}`);

    return new Promise<string>((resolve, reject) => {
        const req = https.request({
            method,
            path: fullPath,
            headers,
            hostname,
        }, res => {
            // console.log('Headers: ' + JSON.stringify(res.headers, undefined, 2));
            lastRateLimit = +(res.headers['x-ratelimit-limit']);
            lastRateLimitRemaining = +(res.headers['x-ratelimit-remaining']);
            if (res.statusCode! >= 400) {
                console.log(`Error! Status code ${res.statusCode} returned`);
                reject(`Status code ${res.statusCode} returned`);
                return;
            }

            res.setEncoding('utf8');
            var data = '';
            res.on('data', chunk => {
                data = data + chunk;
            });
            res.on('end', () => {
                resolve(data);
            });
            res.on('error', err => {
                console.log('Connection Error!');
                console.log(err);
                reject(err);
            })
        });
        if (bodyStream !== undefined) {
            req.write(bodyStream);
        }
        req.end();
    });
}
