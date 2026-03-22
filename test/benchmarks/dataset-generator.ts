/**
 * Dataset generator for benchmark tests
 *
 * Generates realistic test datasets at various scales (1K, 10K, 100K messages)
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface DatasetConfig {
  messageCount: number;
  conversationCount?: number;
  averageMessageLength?: number;
  technologies?: string[];
  modelFamily?: string;
}

/**
 * Technology keywords and templates for realistic content
 */
const TECHNOLOGIES = [
  'React',
  'TypeScript',
  'Node.js',
  'PostgreSQL',
  'MongoDB',
  'Redis',
  'Docker',
  'Kubernetes',
  'AWS',
  'Python',
  'Django',
  'FastAPI',
  'GraphQL',
  'REST API',
  'WebSocket',
  'JWT',
  'OAuth',
  'Git',
  'CI/CD',
  'Terraform',
];

const QUESTION_TEMPLATES = [
  'How do I implement {tech} in my project?',
  'What is the best way to use {tech} for {purpose}?',
  'I am getting an error with {tech}, can you help?',
  'Explain the difference between {tech1} and {tech2}',
  'How do I optimize {tech} performance?',
  'What are the best practices for {tech}?',
  'Can you show me an example of {tech}?',
  'How do I debug {tech} issues?',
  'What is {tech} and when should I use it?',
  'How do I integrate {tech} with {tech2}?',
];

const ANSWER_TEMPLATES = [
  'To implement {tech}, you should first understand...',
  'The best approach for {tech} is to...',
  'That error typically occurs when...',
  'The main difference is that {tech1} focuses on... while {tech2}...',
  'For optimization, consider these strategies...',
  'Best practices include: 1. Always... 2. Never... 3. Consider...',
  'Here is a code example:\n```\n// Example code here\n```',
  'To debug this, try the following steps...',
  '{tech} is a tool/library/framework that...',
  'Integration typically involves these steps...',
];

const PURPOSES = [
  'authentication',
  'data storage',
  'caching',
  'API development',
  'frontend rendering',
  'state management',
  'testing',
  'deployment',
  'monitoring',
  'security',
];

/**
 * Generate a random item from an array
 */
function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate a realistic question
 */
function generateQuestion(technologies: string[]): string {
  const template = randomItem(QUESTION_TEMPLATES);
  const tech = randomItem(technologies);
  const tech2 = randomItem(technologies.filter(t => t !== tech));
  const purpose = randomItem(PURPOSES);

  return template
    .replace('{tech}', tech)
    .replace('{tech1}', tech)
    .replace('{tech2}', tech2)
    .replace('{purpose}', purpose);
}

/**
 * Generate a realistic answer
 */
function generateAnswer(technologies: string[], length: number): string {
  const template = randomItem(ANSWER_TEMPLATES);
  const tech = randomItem(technologies);
  const tech2 = randomItem(technologies.filter(t => t !== tech));

  let answer = template
    .replace('{tech}', tech)
    .replace('{tech1}', tech)
    .replace('{tech2}', tech2);

  // Pad to desired length
  while (answer.length < length) {
    answer += ` Additional details about ${tech} include various considerations and best practices.`;
  }

  return answer.substring(0, length);
}

/**
 * Generate a dataset with specified configuration
 */
export function generateDataset(config: DatasetConfig): string[] {
  const {
    messageCount,
    conversationCount = Math.ceil(messageCount / 10),
    averageMessageLength = 200,
    technologies = TECHNOLOGIES,
  } = config;

  const messagesPerConversation = Math.ceil(messageCount / conversationCount);
  const messages: string[] = [];
  const baseTimestamp = Date.now() - messageCount * 60000; // Start N minutes ago

  for (let convIndex = 0; convIndex < conversationCount; convIndex++) {
    const messagesInThisConv = Math.min(
      messagesPerConversation,
      messageCount - messages.length
    );

    for (let msgIndex = 0; msgIndex < messagesInThisConv; msgIndex++) {
      const isUser = msgIndex % 2 === 0;
      const role = isUser ? 'user' : 'assistant';

      // Vary message length (50% to 150% of average)
      const lengthVariation = 0.5 + Math.random();
      const targetLength = Math.floor(averageMessageLength * lengthVariation);

      const content = isUser
        ? generateQuestion(technologies)
        : generateAnswer(technologies, targetLength);

      const timestamp = baseTimestamp + (convIndex * messagesPerConversation + msgIndex) * 60000;

      const message = {
        role,
        content,
        timestamp,
      };

      messages.push(JSON.stringify(message));
    }
  }

  return messages;
}

/**
 * Write dataset to JSONL file
 */
export function writeDataset(
  messages: string[],
  filename: string,
  outputDir: string = join(process.cwd(), 'test', 'fixtures', 'datasets')
): void {
  mkdirSync(outputDir, { recursive: true });
  const filepath = join(outputDir, filename);
  writeFileSync(filepath, messages.join('\n'), 'utf-8');
  console.log(`Generated ${messages.length} messages -> ${filepath}`);
}

/**
 * Generate all standard benchmark datasets
 */
export function generateAllDatasets(): void {
  console.log('Generating benchmark datasets...');

  // 1K dataset
  const dataset1K = generateDataset({
    messageCount: 1000,
    conversationCount: 50,
    averageMessageLength: 150,
  });
  writeDataset(dataset1K, 'dataset-1K.jsonl');

  // 10K dataset
  const dataset10K = generateDataset({
    messageCount: 10000,
    conversationCount: 500,
    averageMessageLength: 200,
  });
  writeDataset(dataset10K, 'dataset-10K.jsonl');

  // 100K dataset
  const dataset100K = generateDataset({
    messageCount: 100000,
    conversationCount: 5000,
    averageMessageLength: 250,
  });
  writeDataset(dataset100K, 'dataset-100K.jsonl');

  console.log('Dataset generation complete!');
}

/**
 * CLI entry point
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  generateAllDatasets();
}
