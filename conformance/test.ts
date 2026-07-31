import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

interface TestVector {
  name: string;
  description: string;
  input: unknown;
  expected: { valid: boolean; error?: string };
}

interface ConformanceSuite {
  version: string;
  description: string;
  vectors: TestVector[];
}

function loadVectors(): ConformanceSuite {
  const vectorsDir = join(__dirname, 'vectors');
  const files = readdirSync(vectorsDir).filter(f => f.endsWith('.json'));
  
  const allVectors: TestVector[] = [];
  
  for (const file of files) {
    const content = readFileSync(join(vectorsDir, file), 'utf-8');
    const suite = JSON.parse(content) as ConformanceSuite;
    allVectors.push(...suite.vectors);
  }
  
  return { version: '1.0.0', description: 'PAI Email Agent Conformance', vectors: allVectors };
}

function validateEmail(input: unknown): { valid: boolean; error?: string } {
  // This is a reference implementation - actual implementations should match
  const obj = input as Record<string, unknown>;
  
  // Required fields
  const required = ['to', 'from', 'subject', 'body', 'agentId', 'timestamp'];
  const missing = required.filter(f => !(f in obj));
  if (missing.length > 0) {
    return { valid: false, error: `Required fields missing: ${missing.join(', ')}` };
  }
  
  // Email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (typeof obj.to !== 'string' || !emailRegex.test(obj.to)) {
    return { valid: false, error: 'to must be a valid email' };
  }
  if (typeof obj.from !== 'string' || !emailRegex.test(obj.from)) {
    return { valid: false, error: 'from must be a valid email' };
  }
  
  // Agent ID format
  const agentIdRegex = /^[a-z0-9][a-z0-9-]{2,29}$/;
  if (typeof obj.agentId !== 'string' || !agentIdRegex.test(obj.agentId)) {
    return { valid: false, error: 'agentId must match ^[a-z0-9][a-z0-9-]{2,29}$' };
  }
  
  // Body size limit
  if (typeof obj.body === 'string' && obj.body.length > 65536) {
    return { valid: false, error: 'body must be at most 65536 characters' };
  }
  
  // Attachments limit
  if (Array.isArray(obj.attachments) && obj.attachments.length > 10) {
    return { valid: false, error: 'attachments must have at most 10 items' };
  }
  
  // Timestamp format
  if (typeof obj.timestamp !== 'string' || isNaN(Date.parse(obj.timestamp))) {
    return { valid: false, error: 'timestamp must be valid ISO 8601' };
  }
  
  // Agent ID matches email local part
  const localPart = obj.to.split('@')[0]?.toLowerCase();
  if (obj.agentId !== localPart) {
    return { valid: false, error: 'agentId must match email local part' };
  }
  
  return { valid: true };
}

function runTests() {
  const suite = loadVectors();
  let passed = 0;
  let failed = 0;
  
  console.log(`🧪 Running ${suite.vectors.length} conformance tests...\n`);
  
  for (const vector of suite.vectors) {
    const result = validateEmail(vector.input);
    const success = result.valid === vector.expected.valid && 
      (!vector.expected.error || result.error === vector.expected.error);
    
    if (success) {
      console.log(`✅ ${vector.name}`);
      passed++;
    } else {
      console.log(`❌ ${vector.name}`);
      console.log(`   Expected: valid=${vector.expected.valid}${vector.expected.error ? `, error="${vector.expected.error}"` : ''}`);
      console.log(`   Got:      valid=${result.valid}${result.error ? `, error="${result.error}"` : ''}`);
      failed++;
    }
  }
  
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();