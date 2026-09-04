import axios, { AxiosAdapter } from 'axios';

const demoModeEnabled = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false';

const demoTenders = [
  {
    id: 'demo-tender-1',
    title: 'Digital Transformation and Cloud Modernization',
    description: 'Enterprise cloud migration, data platform modernization, and digital service delivery.',
    organization: 'Government of Canada',
    category: 'Technology',
    deadline: '2026-12-18T23:59:00.000Z',
    budget_range: '$2M - $5M',
    location: 'Ottawa, Canada',
    country: 'Canada',
    source_url: 'https://canada.ca/procurement',
    published_date: '2026-08-22T12:00:00.000Z',
    source: { name: 'CanadaBuys', url: 'https://canada.ca/procurement', region: 'Canada' },
  },
  {
    id: 'demo-tender-2',
    title: 'AI-Powered Public Health Analytics Platform',
    description: 'Predictive analytics and responsible AI tools for public health planning and reporting.',
    organization: 'World Health Organization',
    category: 'Healthcare',
    deadline: '2026-11-30T23:59:00.000Z',
    budget_range: '$750K - $1.5M',
    location: 'Geneva, Switzerland',
    country: 'Switzerland',
    source_url: 'https://www.ungm.org',
    published_date: '2026-08-25T12:00:00.000Z',
    source: { name: 'UNGM', url: 'https://www.ungm.org', region: 'Worldwide' },
  },
  {
    id: 'demo-tender-3',
    title: 'Sustainable Infrastructure Advisory Services',
    description: 'Advisory services for resilient infrastructure programs, procurement, and delivery.',
    organization: 'European Investment Bank',
    category: 'Consulting',
    deadline: '2027-01-15T23:59:00.000Z',
    budget_range: '$1M - $3M',
    location: 'Brussels, Belgium',
    country: 'Belgium',
    source_url: 'https://ted.europa.eu',
    published_date: '2026-08-28T12:00:00.000Z',
    source: { name: 'TED Europa', url: 'https://ted.europa.eu', region: 'Worldwide' },
  },
];

const demoMatches = demoTenders.map((tender, index) => ({
  id: `demo-match-${index + 1}`,
  match_score: [94, 87, 81][index],
  match_explanation: 'Strong alignment with the platform capabilities, delivery experience, and service keywords in this demo profile.',
  tender,
}));

const demoResponse: AxiosAdapter = async (config) => {
  const url = config.url || '';
  const method = (config.method || 'get').toLowerCase();
  let data: unknown = {};

  if (url === '/auth/me') {
    data = { id: 'demo-guest', email: 'demo@local.invalid', first_name: 'Demo', last_name: 'Guest', role: 'admin' };
  } else if (url === '/company/my-profile') {
    data = { id: 'demo-company', company_name: 'Aarim Demo Group', industry: 'Technology', services: ['AI Solutions', 'Cloud Modernization'], keywords: ['AI', 'data', 'digital transformation'], description: 'Demo company profile for exploring tender matching.', country: 'Canada', certifications: [] };
  } else if (url === '/dashboard/stats') {
    data = { totalMatches: 3, highScoreMatches: 3, avgScore: 87, activeDeadlines: 3 };
  } else if (url === '/dashboard/tenders') {
    data = { matches: demoMatches, total: demoMatches.length };
  } else if (url === '/tender-search/categories') {
    data = ['Technology', 'Healthcare', 'Consulting', 'Construction'];
  } else if (url === '/tender-search/countries') {
    data = ['Canada', 'Switzerland', 'Belgium'];
  } else if (url === '/tender-search/sources') {
    data = demoTenders.map(({ source }) => source);
  } else if (url === '/tender-search') {
    data = { tenders: demoTenders, total: demoTenders.length, page: 1, limit: 20 };
  } else if (url === '/matching/run' && method === 'post') {
    data = { success: true, message: 'Demo matching complete.' };
  } else if (url === '/admin/stats') {
    data = { total_users: 128, total_companies: 46, total_tenders: 5240, active_sessions: 37 };
  } else if (url === '/admin/audit-logs') {
    data = { logs: [{ id: 'demo-log-1', action: 'demo.session_started', user: 'Demo Guest', timestamp: new Date().toISOString(), ip: '127.0.0.1' }] };
  } else if (url === '/admin/users') {
    data = { users: [{ id: 'demo-user-1', name: 'Demo Guest', email: 'demo@local.invalid', role: 'admin', status: 'active' }] };
  } else if (url === '/admin/invite-codes') {
    data = { codes: [] };
  } else if (url === '/tenders/all') {
    data = demoTenders.map((tender) => ({ id: tender.id, title: tender.title, source: tender.source?.name || '', score: 88, status: 'active', scraped_at: tender.published_date }));
  } else if (url === '/scraping/sources/statistics') {
    data = [];
  } else if (url.startsWith('/admin/') || url.startsWith('/scraping/')) {
    data = { success: true, message: 'Demo action completed.' };
  } else if (url.startsWith('/company') && method === 'get') {
    data = { id: 'demo-company', company_name: 'Aarim Demo Group', industry: 'Technology', services: ['AI Solutions'], keywords: ['AI', 'data'], description: 'Demo company profile.', country: 'Canada', certifications: [] };
  } else if (url === '/auth/demo') {
    data = { access_token: 'demo-access-token', refresh_token: 'demo-refresh-token', user: { id: 'demo-guest', email: 'demo@local.invalid', first_name: 'Demo', last_name: 'Guest', role: 'admin' } };
  }

  return { data, status: 200, statusText: 'OK', headers: {}, config };
};

const api = axios.create({
  headers: { 'Content-Type': 'application/json' },
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001',
});

if (demoModeEnabled) {
  api.defaults.adapter = demoResponse;
}

// Add auth header on every request
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Prevent concurrent refresh races: if a refresh is already in-flight,
// queue subsequent 401s and resolve them when the refresh completes.
let refreshing: Promise<string> | null = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !demoModeEnabled &&
      !originalRequest.url?.includes('/auth/login') &&
      !originalRequest.url?.includes('/auth/refresh')
    ) {
      originalRequest._retry = true;

      try {
        const refreshToken = localStorage.getItem('refresh_token');
        if (!refreshToken) {
          throw new Error('No refresh token available');
        }

        // If a refresh is already in-flight, wait for it instead of firing a second one
        if (!refreshing) {
          refreshing = axios
            .post(
              `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/auth/refresh`,
              { refresh_token: refreshToken },
              { headers: { 'Content-Type': 'application/json' } },
            )
            .then((res) => {
              const { access_token, refresh_token } = res.data;
              localStorage.setItem('access_token', access_token);
              localStorage.setItem('refresh_token', refresh_token);
              return access_token;
            })
            .finally(() => {
              refreshing = null;
            });
        }

        const newAccessToken = await refreshing;
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(originalRequest);
      } catch {
        // Refresh failed — clear tokens and send user to login
        if (typeof window !== 'undefined') {
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          window.location.href = '/auth/login?expired=true';
        }
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  },
);

export default api;
