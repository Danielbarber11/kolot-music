import { GitHubRepo } from '../types';

export async function searchGitHubRepos(query: string, limit: number = 6): Promise<GitHubRepo[]> {
  if (!query.trim()) return [];

  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(
    query
  )}&sort=stars&order=desc&per_page=${limit}`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!res.ok) throw new Error('GitHub search API failed');
    const data = await res.json();

    const items = data.items || [];
    return items.map((item: any) => ({
      id: item.id,
      name: item.name,
      fullName: item.full_name,
      owner: {
        login: item.owner?.login || 'github',
        avatarUrl: item.owner?.avatar_url || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
        htmlUrl: item.owner?.html_url || 'https://github.com',
      },
      description: item.description || 'No description provided.',
      stars: item.stargazers_count || 0,
      forks: item.forks_count || 0,
      openIssues: item.open_issues_count || 0,
      language: item.language,
      htmlUrl: item.html_url,
      updatedAt: item.updated_at,
      topics: (item.topics || []).slice(0, 4),
    }));
  } catch (err) {
    console.error('GitHub search error:', err);
    return [];
  }
}

export const CURATED_GITHUB_REPOS: GitHubRepo[] = [
  {
    id: 1,
    name: 'react',
    fullName: 'facebook/react',
    owner: {
      login: 'facebook',
      avatarUrl: 'https://avatars.githubusercontent.com/u/69631?v=4',
      htmlUrl: 'https://github.com/facebook',
    },
    description: 'The library for web and native user interfaces.',
    stars: 230000,
    forks: 46000,
    openIssues: 800,
    language: 'JavaScript',
    htmlUrl: 'https://github.com/facebook/react',
    updatedAt: '2026-11-01',
    topics: ['react', 'ui', 'frontend', 'declarative'],
  },
  {
    id: 2,
    name: 'vscode',
    fullName: 'microsoft/vscode',
    owner: {
      login: 'microsoft',
      avatarUrl: 'https://avatars.githubusercontent.com/u/6154722?v=4',
      htmlUrl: 'https://github.com/microsoft',
    },
    description: 'Visual Studio Code IDE engine.',
    stars: 165000,
    forks: 32000,
    openIssues: 5000,
    language: 'TypeScript',
    htmlUrl: 'https://github.com/microsoft/vscode',
    updatedAt: '2026-11-01',
    topics: ['editor', 'developer-tools', 'electron'],
  },
];
