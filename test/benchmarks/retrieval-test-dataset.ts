/**
 * Retrieval Test Dataset Generator
 *
 * Creates curated test cases with ground truth relevance labels
 * for evaluating context retrieval accuracy.
 */

import type { Message } from '../../src/core/service.js';

export type ScenarioType = 'technical' | 'temporal' | 'multi-hop' | 'disambiguation';

export interface RetrievalTestCase {
  id: string;
  scenario: ScenarioType;
  query: string;
  conversationHistory: Message[];
  groundTruthRelevant: string[]; // message IDs that should be retrieved
  description: string;
  expectedPrecision?: number; // Optional target for this specific test case
}

/**
 * Generate a message with specified properties
 */
function createMessage(
  id: string,
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  createdAt: number
): Message {
  return {
    message_id: id,
    conversation_id: conversationId,
    role,
    content,
    created_at: createdAt,
    tokens: Math.ceil(content.length / 4), // Rough approximation
    model_family: 'claude-3-5-sonnet',
    sequence_num: 0, // Will be set by service
  };
}

/**
 * Generate retrieval test dataset
 */
export function generateRetrievalTestDataset(): RetrievalTestCase[] {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const oneMonthAgo = now - 30 * 24 * 60 * 60 * 1000;

  const testCases: RetrievalTestCase[] = [];

  // ============================================
  // TECHNICAL SCENARIOS
  // ============================================

  // Test Case 1: Specific technical error
  testCases.push({
    id: 'tech-001',
    scenario: 'technical',
    query: 'How do I fix the database connection timeout error?',
    description: 'Should retrieve messages about database timeouts, not general database discussions',
    conversationHistory: [
      createMessage(
        'msg-001',
        'conv-001',
        'user',
        'I am getting a database connection timeout error when trying to connect to PostgreSQL',
        oneDayAgo
      ),
      createMessage(
        'msg-002',
        'conv-001',
        'assistant',
        'Database connection timeouts can occur for several reasons. First, check your connection pool settings. Increase the timeout value in your database config from the default 30s to 60s or higher.',
        oneDayAgo
      ),
      createMessage(
        'msg-003',
        'conv-001',
        'user',
        'Where do I set the timeout value?',
        oneDayAgo
      ),
      createMessage(
        'msg-004',
        'conv-001',
        'assistant',
        'In your database configuration file, add: connection_timeout = 60000 (in milliseconds). Also ensure your firewall is not blocking the connection.',
        oneDayAgo
      ),
      createMessage(
        'msg-005',
        'conv-002',
        'user',
        'How do I set up PostgreSQL on Ubuntu?',
        oneWeekAgo
      ),
      createMessage(
        'msg-006',
        'conv-002',
        'assistant',
        'To set up PostgreSQL on Ubuntu, run: sudo apt-get install postgresql postgresql-contrib',
        oneWeekAgo
      ),
      createMessage(
        'msg-007',
        'conv-003',
        'user',
        'What are the advantages of PostgreSQL over MySQL?',
        oneMonthAgo
      ),
      createMessage(
        'msg-008',
        'conv-003',
        'assistant',
        'PostgreSQL offers better support for complex queries, JSON data types, and ACID compliance.',
        oneMonthAgo
      ),
    ],
    groundTruthRelevant: ['msg-001', 'msg-002', 'msg-004'], // Only timeout-related messages
  });

  // Test Case 2: Conceptual question
  testCases.push({
    id: 'tech-002',
    scenario: 'technical',
    query: 'What is the difference between JWT and session-based authentication?',
    description: 'Should retrieve comparative discussion, not isolated mentions',
    conversationHistory: [
      createMessage(
        'msg-101',
        'conv-101',
        'user',
        'What is the difference between JWT and session-based authentication?',
        oneWeekAgo
      ),
      createMessage(
        'msg-102',
        'conv-101',
        'assistant',
        'JWT (JSON Web Tokens) and session-based authentication are two different approaches. JWT is stateless - the token contains all user information and is stored client-side. Session-based auth is stateful - server maintains session data and only sends a session ID to the client. JWT scales better for distributed systems, while sessions are simpler and can be revoked immediately.',
        oneWeekAgo
      ),
      createMessage(
        'msg-103',
        'conv-102',
        'user',
        'How do I implement JWT authentication in Express?',
        oneDayAgo
      ),
      createMessage(
        'msg-104',
        'conv-102',
        'assistant',
        'Install jsonwebtoken: npm install jsonwebtoken. Then create a token: jwt.sign({ userId }, SECRET_KEY, { expiresIn: "1h" })',
        oneDayAgo
      ),
      createMessage(
        'msg-105',
        'conv-103',
        'user',
        'How do session cookies work?',
        oneMonthAgo
      ),
      createMessage(
        'msg-106',
        'conv-103',
        'assistant',
        'Session cookies store a session ID that references server-side session data. The server validates the session ID on each request.',
        oneMonthAgo
      ),
    ],
    groundTruthRelevant: ['msg-101', 'msg-102'], // Only the comparative discussion
  });

  // Test Case 3: Code debugging
  testCases.push({
    id: 'tech-003',
    scenario: 'technical',
    query: 'Why is my React component re-rendering infinitely?',
    description: 'Should retrieve infinite re-render discussions and solutions',
    conversationHistory: [
      createMessage(
        'msg-201',
        'conv-201',
        'user',
        'My React component keeps re-rendering infinitely. The console is flooding with render logs.',
        oneHourAgo
      ),
      createMessage(
        'msg-202',
        'conv-201',
        'assistant',
        'Infinite re-renders in React usually occur when state updates trigger the same state update in an endless loop. Common causes: 1) Calling setState directly in render, 2) useEffect without dependencies, 3) Creating new objects/functions in render that trigger re-renders.',
        oneHourAgo
      ),
      createMessage(
        'msg-203',
        'conv-201',
        'user',
        'I have useEffect(() => { setCount(count + 1) }, [count])',
        oneHourAgo
      ),
      createMessage(
        'msg-204',
        'conv-201',
        'assistant',
        'That is the problem! You are updating count inside useEffect and listing count as a dependency. This creates an infinite loop: count changes → useEffect runs → count updates → useEffect runs again. Remove count from dependencies or use the functional update: setCount(c => c + 1)',
        oneHourAgo
      ),
      createMessage(
        'msg-205',
        'conv-202',
        'user',
        'How do I optimize React performance?',
        oneWeekAgo
      ),
      createMessage(
        'msg-206',
        'conv-202',
        'assistant',
        'Use React.memo, useMemo, useCallback, lazy loading, and code splitting.',
        oneWeekAgo
      ),
    ],
    groundTruthRelevant: ['msg-201', 'msg-202', 'msg-203', 'msg-204'], // Full debugging thread
  });

  // ============================================
  // TEMPORAL SCENARIOS
  // ============================================

  // Test Case 4: Recent decision
  testCases.push({
    id: 'temporal-001',
    scenario: 'temporal',
    query: 'What did we decide about the authentication approach today?',
    description: 'Should prioritize recent messages about authentication decisions',
    conversationHistory: [
      createMessage(
        'msg-301',
        'conv-301',
        'user',
        'Should we use OAuth or build custom authentication?',
        oneHourAgo
      ),
      createMessage(
        'msg-302',
        'conv-301',
        'assistant',
        'For this project, I recommend using OAuth 2.0 with Google and GitHub providers. It is more secure and saves development time.',
        oneHourAgo
      ),
      createMessage(
        'msg-303',
        'conv-301',
        'user',
        'Agreed. Let us go with OAuth. Which library should we use?',
        oneHourAgo
      ),
      createMessage(
        'msg-304',
        'conv-301',
        'assistant',
        'Use next-auth for Next.js or passport.js for Express. Both have excellent OAuth provider support.',
        oneHourAgo
      ),
      createMessage(
        'msg-305',
        'conv-302',
        'user',
        'How does OAuth work?',
        oneMonthAgo
      ),
      createMessage(
        'msg-306',
        'conv-302',
        'assistant',
        'OAuth is an authorization framework that allows third-party applications to access user data without exposing passwords.',
        oneMonthAgo
      ),
    ],
    groundTruthRelevant: ['msg-301', 'msg-302', 'msg-303', 'msg-304'], // Recent decision thread
  });

  // Test Case 5: Last week's discussion
  testCases.push({
    id: 'temporal-002',
    scenario: 'temporal',
    query: 'What API rate limiting strategy did we discuss last week?',
    description: 'Should retrieve week-old messages about rate limiting',
    conversationHistory: [
      createMessage(
        'msg-401',
        'conv-401',
        'user',
        'We need to implement rate limiting for our API. What strategy should we use?',
        oneWeekAgo
      ),
      createMessage(
        'msg-402',
        'conv-401',
        'assistant',
        'I recommend a token bucket algorithm with Redis for distributed rate limiting. Set limits per IP and per API key: 100 requests/minute for authenticated users, 20 requests/minute for unauthenticated.',
        oneWeekAgo
      ),
      createMessage(
        'msg-403',
        'conv-402',
        'user',
        'How do I set up Redis?',
        oneDayAgo
      ),
      createMessage(
        'msg-404',
        'conv-402',
        'assistant',
        'Install Redis: brew install redis (macOS) or apt-get install redis (Ubuntu)',
        oneDayAgo
      ),
      createMessage(
        'msg-405',
        'conv-403',
        'user',
        'What is rate limiting?',
        oneMonthAgo
      ),
      createMessage(
        'msg-406',
        'conv-403',
        'assistant',
        'Rate limiting controls how many requests a user can make to an API in a given time period.',
        oneMonthAgo
      ),
    ],
    groundTruthRelevant: ['msg-401', 'msg-402'], // Week-old discussion about strategy
  });

  // ============================================
  // MULTI-HOP REASONING
  // ============================================

  // Test Case 6: Follow reference
  testCases.push({
    id: 'multi-hop-001',
    scenario: 'multi-hop',
    query: 'What was the solution to the bug Sarah reported?',
    description: 'Should connect Sarah\'s bug report with subsequent discussion and solution',
    conversationHistory: [
      createMessage(
        'msg-501',
        'conv-501',
        'user',
        'Sarah reported a bug where user avatars are not loading',
        oneDayAgo
      ),
      createMessage(
        'msg-502',
        'conv-501',
        'assistant',
        'Let me help investigate the avatar loading issue Sarah found.',
        oneDayAgo
      ),
      createMessage(
        'msg-503',
        'conv-501',
        'user',
        'The images are returning 404 errors',
        oneDayAgo
      ),
      createMessage(
        'msg-504',
        'conv-501',
        'assistant',
        'The issue is that the avatar URL path is incorrect. It is pointing to /static/avatars/ but should be /public/avatars/. Update the IMAGE_BASE_URL environment variable to fix this.',
        oneDayAgo
      ),
      createMessage(
        'msg-505',
        'conv-501',
        'user',
        'That fixed it! Thanks.',
        oneDayAgo
      ),
      createMessage(
        'msg-506',
        'conv-502',
        'user',
        'How do I upload user avatars?',
        oneWeekAgo
      ),
      createMessage(
        'msg-507',
        'conv-502',
        'assistant',
        'Use multer for file uploads in Express.',
        oneWeekAgo
      ),
    ],
    groundTruthRelevant: ['msg-501', 'msg-502', 'msg-503', 'msg-504', 'msg-505'], // Full bug thread
  });

  // Test Case 7: Trace decision through conversation
  testCases.push({
    id: 'multi-hop-002',
    scenario: 'multi-hop',
    query: 'Why did we choose MongoDB over PostgreSQL for this project?',
    description: 'Should retrieve the discussion that led to the database decision',
    conversationHistory: [
      createMessage(
        'msg-601',
        'conv-601',
        'user',
        'We need to choose a database. Should we use PostgreSQL or MongoDB?',
        oneWeekAgo
      ),
      createMessage(
        'msg-602',
        'conv-601',
        'assistant',
        'Both are good options. What is your data structure like? Is it mostly relational or document-based?',
        oneWeekAgo
      ),
      createMessage(
        'msg-603',
        'conv-601',
        'user',
        'Our data is highly nested JSON objects with varying schemas. We also need flexible schema evolution.',
        oneWeekAgo
      ),
      createMessage(
        'msg-604',
        'conv-601',
        'assistant',
        'Given your requirements - nested JSON with varying schemas and need for schema flexibility - MongoDB is the better choice. PostgreSQL can store JSON but MongoDB is optimized for this use case and makes schema evolution much easier.',
        oneWeekAgo
      ),
      createMessage(
        'msg-605',
        'conv-601',
        'user',
        'Makes sense. Let us go with MongoDB.',
        oneWeekAgo
      ),
      createMessage(
        'msg-606',
        'conv-602',
        'user',
        'How do I install MongoDB?',
        oneDayAgo
      ),
      createMessage(
        'msg-607',
        'conv-602',
        'assistant',
        'brew tap mongodb/brew && brew install mongodb-community',
        oneDayAgo
      ),
    ],
    groundTruthRelevant: ['msg-601', 'msg-602', 'msg-603', 'msg-604', 'msg-605'], // Decision thread
  });

  // ============================================
  // DISAMBIGUATION SCENARIOS
  // ============================================

  // Test Case 8: Distinguish similar topics
  testCases.push({
    id: 'disambig-001',
    scenario: 'disambiguation',
    query: 'How do I configure CORS for the API server?',
    description: 'Should retrieve API CORS config, not frontend or general CORS discussions',
    conversationHistory: [
      createMessage(
        'msg-701',
        'conv-701',
        'user',
        'I am getting CORS errors when my frontend calls the API',
        oneDayAgo
      ),
      createMessage(
        'msg-702',
        'conv-701',
        'assistant',
        'You need to configure CORS on your API server. In Express, install cors: npm install cors, then use: app.use(cors({ origin: "http://localhost:3000", credentials: true }))',
        oneDayAgo
      ),
      createMessage(
        'msg-703',
        'conv-702',
        'user',
        'What is CORS and why does it exist?',
        oneWeekAgo
      ),
      createMessage(
        'msg-704',
        'conv-702',
        'assistant',
        'CORS (Cross-Origin Resource Sharing) is a security mechanism that restricts web pages from making requests to different domains.',
        oneWeekAgo
      ),
      createMessage(
        'msg-705',
        'conv-703',
        'user',
        'How do I make CORS requests from the browser?',
        oneMonthAgo
      ),
      createMessage(
        'msg-706',
        'conv-703',
        'assistant',
        'Use fetch with credentials: fetch(url, { credentials: "include" })',
        oneMonthAgo
      ),
    ],
    groundTruthRelevant: ['msg-701', 'msg-702'], // Only API server configuration
  });

  // Test Case 9: Specific vs general
  testCases.push({
    id: 'disambig-002',
    scenario: 'disambiguation',
    query: 'How do I deploy to production on AWS?',
    description: 'Should retrieve AWS deployment specifics, not general deployment or other platforms',
    conversationHistory: [
      createMessage(
        'msg-801',
        'conv-801',
        'user',
        'I need to deploy our app to production on AWS. What is the best approach?',
        oneHourAgo
      ),
      createMessage(
        'msg-802',
        'conv-801',
        'assistant',
        'For AWS deployment, I recommend using ECS with Fargate for containerized apps. Steps: 1) Push Docker image to ECR, 2) Create ECS cluster, 3) Define task definition, 4) Create service with load balancer, 5) Configure auto-scaling.',
        oneHourAgo
      ),
      createMessage(
        'msg-803',
        'conv-802',
        'user',
        'How do I deploy to Vercel?',
        oneDayAgo
      ),
      createMessage(
        'msg-804',
        'conv-802',
        'assistant',
        'Vercel deployment is simple: vercel --prod',
        oneDayAgo
      ),
      createMessage(
        'msg-805',
        'conv-803',
        'user',
        'What is the deployment checklist?',
        oneWeekAgo
      ),
      createMessage(
        'msg-806',
        'conv-803',
        'assistant',
        'General deployment checklist: 1) Run tests, 2) Update dependencies, 3) Set environment variables, 4) Configure monitoring, 5) Set up backups',
        oneWeekAgo
      ),
    ],
    groundTruthRelevant: ['msg-801', 'msg-802'], // Only AWS-specific deployment
  });

  // Test Case 10: Edge case - No relevant messages
  testCases.push({
    id: 'edge-001',
    scenario: 'technical',
    query: 'How do I implement blockchain smart contracts?',
    description: 'No relevant messages exist - should return empty or low scores',
    conversationHistory: [
      createMessage(
        'msg-901',
        'conv-901',
        'user',
        'How do I set up React Router?',
        oneDayAgo
      ),
      createMessage(
        'msg-902',
        'conv-901',
        'assistant',
        'Install react-router-dom: npm install react-router-dom',
        oneDayAgo
      ),
      createMessage(
        'msg-903',
        'conv-902',
        'user',
        'How do I style components with Tailwind?',
        oneWeekAgo
      ),
      createMessage(
        'msg-904',
        'conv-902',
        'assistant',
        'Add Tailwind classes to className props.',
        oneWeekAgo
      ),
    ],
    groundTruthRelevant: [], // No relevant messages
  });

  return testCases;
}

/**
 * Get test case by ID
 */
export function getTestCase(id: string): RetrievalTestCase | undefined {
  const dataset = generateRetrievalTestDataset();
  return dataset.find(tc => tc.id === id);
}

/**
 * Get test cases by scenario type
 */
export function getTestCasesByScenario(scenario: ScenarioType): RetrievalTestCase[] {
  const dataset = generateRetrievalTestDataset();
  return dataset.filter(tc => tc.scenario === scenario);
}

/**
 * Get dataset statistics
 */
export function getDatasetStats() {
  const dataset = generateRetrievalTestDataset();

  const stats = {
    totalTestCases: dataset.length,
    byScenario: {
      technical: dataset.filter(tc => tc.scenario === 'technical').length,
      temporal: dataset.filter(tc => tc.scenario === 'temporal').length,
      'multi-hop': dataset.filter(tc => tc.scenario === 'multi-hop').length,
      disambiguation: dataset.filter(tc => tc.scenario === 'disambiguation').length,
    },
    totalMessages: dataset.reduce((sum, tc) => sum + tc.conversationHistory.length, 0),
    avgMessagesPerCase: dataset.reduce((sum, tc) => sum + tc.conversationHistory.length, 0) / dataset.length,
    avgRelevantPerCase: dataset.reduce((sum, tc) => sum + tc.groundTruthRelevant.length, 0) / dataset.length,
  };

  return stats;
}
