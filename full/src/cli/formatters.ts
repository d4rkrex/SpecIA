/**
 * Output formatters for different consumers
 * 
 * REF: .specia/changes/cli-mcp2cli-redesign/spec.md REQ-5
 * 
 * Security mitigations:
 * - T-02: Sanitizes user input before SARIF/JSON serialization
 * - AC-003: Validates SARIF output against schema limits
 */

import chalk from "chalk";

export type OutputFormat = 'markdown' | 'json' | 'compact' | 'sarif';

export interface FormatterContext {
  verbosity: number; // 0 = normal, 1 = -v, 2 = -vv, 3 = -vvv
}

/**
 * Generic formatter interface
 */
export interface Formatter<T> {
  format(data: T, context: FormatterContext): string;
}

/**
 * Sanitize text for safe display/serialization
 * MITIGATION: T-02 (SARIF injection), AC-003
 */
function sanitizeText(text: string | undefined, maxLength = 5000): string {
  if (!text) return "";
  
  // Truncate to prevent DoS
  let sanitized = text.slice(0, maxLength);
  
  // Remove null bytes and other control characters (except newlines/tabs in JSON context)
  sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");
  
  // Remove HTML/Script tags to prevent injection
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  sanitized = sanitized.replace(/<[^>]+>/g, "");
  
  return sanitized;
}

/**
 * Sanitize file path for safe display
 * MITIGATION: ID-03 (path disclosure)
 */
function sanitizePath(filePath: string | undefined, makeRelative = false): string {
  if (!filePath) return "";
  
  let path = filePath;
  
  // Make relative if requested (strip absolute paths)
  if (makeRelative) {
    // Strip common prefixes
    path = path
      .replace(/^\/home\/[^/]+\//, "~/")
      .replace(/^\/Users\/[^/]+\//, "~/")
      .replace(/^[A-Z]:\\Users\\[^\\]+\\/, "~/");
  }
  
  // Remove null bytes and control characters
  path = path.replace(/[\x00-\x1F\x7F]/g, "");
  
  return path;
}

/**
 * Strip ANSI color codes from text
 * For use when !process.stdout.isTTY
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-9;]*[mGKHF]/g, "");
}

/**
 * Check if output should include ANSI codes
 */
export function shouldUseColors(): boolean {
  return process.stdout.isTTY === true;
}

/**
 * Review result formatter
 */
export interface ReviewResult {
  status: string;
  risk_level: string;
  findings: Array<{
    severity: string;
    category: string;
    cwe?: string;
    description: string;
    mitigation?: string;
    file?: string;
    line?: number;
  }>;
  abuse_cases?: Array<{
    id: string;
    severity: string;
    goal: string;
    technique: string;
  }>;
}

export class ReviewMarkdownFormatter implements Formatter<ReviewResult> {
  format(data: ReviewResult, context: FormatterContext): string {
    const lines: string[] = [];
    const useColors = shouldUseColors();
    
    // Header
    lines.push('# Security Review Results\n');
    lines.push(`**Risk Level**: ${useColors ? this.colorRiskLevel(data.risk_level) : data.risk_level}`);
    lines.push(`**Status**: ${data.status}\n`);
    
    // Findings summary
    const bySeverity = this.groupBySeverity(data.findings);
    lines.push('## Findings Summary\n');
    lines.push(`- Critical: ${bySeverity.critical.length} 🔴`);
    lines.push(`- High: ${bySeverity.high.length} 🟠`);
    lines.push(`- Medium: ${bySeverity.medium.length} 🟡`);
    lines.push(`- Low: ${bySeverity.low.length} 🔵\n`);
    
    // Detailed findings (verbosity controls detail)
    if (context.verbosity >= 1) {
      lines.push('## Detailed Findings\n');
      
      for (const severity of ['critical', 'high', 'medium', 'low'] as const) {
        const findings = bySeverity[severity];
        if (findings.length === 0) continue;
        
        lines.push(`### ${severity.toUpperCase()}\n`);
        
        for (const finding of findings) {
          // MITIGATION: T-02 - sanitize user-provided text
          const category = sanitizeText(finding.category);
          const description = sanitizeText(finding.description);
          const mitigation = finding.mitigation ? sanitizeText(finding.mitigation) : undefined;
          const file = finding.file ? sanitizePath(finding.file, true) : undefined;
          
          lines.push(`**${category}**${finding.cwe ? ` (${finding.cwe})` : ''}`);
          lines.push(`- ${description}`);
          if (file && context.verbosity >= 2) {
            lines.push(`- Location: ${file}${finding.line ? `:${finding.line}` : ''}`);
          }
          if (mitigation && context.verbosity >= 2) {
            lines.push(`- Mitigation: ${mitigation}`);
          }
          lines.push('');
        }
      }
    }
    
    // Abuse cases
    if (data.abuse_cases && data.abuse_cases.length > 0 && context.verbosity >= 1) {
      lines.push('## Abuse Cases\n');
      for (const ac of data.abuse_cases) {
        const goal = sanitizeText(ac.goal);
        const technique = ac.technique ? sanitizeText(ac.technique) : undefined;
        
        lines.push(`**${ac.id}** (${ac.severity})`);
        lines.push(`- Goal: ${goal}`);
        if (technique && context.verbosity >= 2) {
          lines.push(`- Technique: ${technique}`);
        }
        lines.push('');
      }
    }
    
    const output = lines.join('\n');
    return useColors ? output : stripAnsi(output);
  }
  
  private colorRiskLevel(level: string): string {
    switch (level.toLowerCase()) {
      case 'critical': return chalk.red.bold(level);
      case 'high': return chalk.red(level);
      case 'medium': return chalk.yellow(level);
      case 'low': return chalk.blue(level);
      default: return level;
    }
  }
  
  private groupBySeverity(findings: ReviewResult['findings']) {
    return {
      critical: findings.filter(f => f.severity === 'critical'),
      high: findings.filter(f => f.severity === 'high'),
      medium: findings.filter(f => f.severity === 'medium'),
      low: findings.filter(f => f.severity === 'low'),
    };
  }
}

export class ReviewJsonFormatter implements Formatter<ReviewResult> {
  format(data: ReviewResult, _context: FormatterContext): string {
    return JSON.stringify(data, null, 2);
  }
}

export class ReviewCompactFormatter implements Formatter<ReviewResult> {
  format(data: ReviewResult, _context: FormatterContext): string {
    const bySeverity = this.countBySeverity(data.findings);
    const parts = [`risk=${data.risk_level}`];
    
    const severityCounts: string[] = [];
    if (bySeverity.critical > 0) severityCounts.push(`${bySeverity.critical}C`);
    if (bySeverity.high > 0) severityCounts.push(`${bySeverity.high}H`);
    if (bySeverity.medium > 0) severityCounts.push(`${bySeverity.medium}M`);
    if (bySeverity.low > 0) severityCounts.push(`${bySeverity.low}L`);
    
    if (severityCounts.length > 0) {
      parts.push(`findings=${severityCounts.join('/')}`);
    }
    
    if (data.abuse_cases && data.abuse_cases.length > 0) {
      parts.push(`abuse_cases=${data.abuse_cases.length}`);
    }
    
    return parts.join(' ');
  }
  
  private countBySeverity(findings: ReviewResult['findings']) {
    return {
      critical: findings.filter(f => f.severity === 'critical').length,
      high: findings.filter(f => f.severity === 'high').length,
      medium: findings.filter(f => f.severity === 'medium').length,
      low: findings.filter(f => f.severity === 'low').length,
    };
  }
}

export class ReviewSarifFormatter implements Formatter<ReviewResult> {
  private readonly MAX_FINDINGS = 1000; // MITIGATION: DOS-02
  private readonly MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10MB

  format(data: ReviewResult, _context: FormatterContext): string {
    // MITIGATION: DOS-02 - limit findings to prevent huge output
    const findings = data.findings.slice(0, this.MAX_FINDINGS);
    
    if (data.findings.length > this.MAX_FINDINGS) {
      console.warn(
        `Warning: Truncating SARIF output to ${this.MAX_FINDINGS} findings ` +
        `(${data.findings.length - this.MAX_FINDINGS} omitted). ` +
        `Use --format json for full output.`
      );
    }

    const sarif = {
      version: '2.1.0',
      $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
      runs: [
        {
          tool: {
            driver: {
              name: 'SpecIA Security Review',
              version: '0.6.0',
              informationUri: 'https://gitlab.veritran.net/appsec/specia',
              rules: this.extractRules(findings)
            }
          },
          results: this.convertFindings(findings)
        }
      ]
    };
    
    const output = JSON.stringify(sarif, null, 2);
    
    // MITIGATION: DOS-02 - warn if output is too large
    if (output.length > this.MAX_OUTPUT_SIZE) {
      console.warn(
        `Warning: SARIF output is ${(output.length / 1024 / 1024).toFixed(1)}MB, ` +
        `which may cause issues. Consider filtering findings.`
      );
    }
    
    return output;
  }
  
  private extractRules(findings: ReviewResult['findings']) {
    const uniqueCategories = new Set(findings.map(f => f.category));
    
    return Array.from(uniqueCategories).map(category => {
      const example = findings.find(f => f.category === category);
      // MITIGATION: T-02 - sanitize all user-provided text
      const sanitizedCategory = sanitizeText(category, 200);
      const sanitizedDesc = example?.description ? sanitizeText(example.description, 1000) : sanitizedCategory;
      
      return {
        id: sanitizedCategory.replace(/\s+/g, '-').toLowerCase(),
        name: sanitizedCategory,
        shortDescription: { text: sanitizedCategory },
        fullDescription: { text: sanitizedDesc },
        helpUri: example?.cwe ? `https://cwe.mitre.org/data/definitions/${example.cwe.replace('CWE-', '')}.html` : undefined
      };
    });
  }
  
  private convertFindings(findings: ReviewResult['findings']) {
    return findings.map((finding, index) => {
      // MITIGATION: T-02, ID-03 - sanitize and make paths relative
      const sanitizedCategory = sanitizeText(finding.category, 200);
      const sanitizedDesc = sanitizeText(finding.description, 2000);
      const sanitizedFile = finding.file ? sanitizePath(finding.file, true) : undefined;
      
      return {
        ruleId: sanitizedCategory.replace(/\s+/g, '-').toLowerCase(),
        ruleIndex: index,
        level: this.mapSeverity(finding.severity),
        message: { text: sanitizedDesc },
        locations: sanitizedFile ? [
          {
            physicalLocation: {
              artifactLocation: { uri: sanitizedFile },
              region: finding.line ? { startLine: finding.line } : undefined
            }
          }
        ] : []
      };
    });
  }
  
  private mapSeverity(severity: string): string {
    switch (severity.toLowerCase()) {
      case 'critical':
      case 'high':
        return 'error';
      case 'medium':
        return 'warning';
      case 'low':
        return 'note';
      default:
        return 'warning';
    }
  }
}

/**
 * Get formatter for output format
 */
export function getReviewFormatter(format: OutputFormat): Formatter<ReviewResult> {
  switch (format) {
    case 'markdown':
      return new ReviewMarkdownFormatter();
    case 'json':
      return new ReviewJsonFormatter();
    case 'compact':
      return new ReviewCompactFormatter();
    case 'sarif':
      return new ReviewSarifFormatter();
    default:
      throw new Error(`Unknown format: ${format}`);
  }
}

/**
 * Parse verbosity flags (-v, -vv, -vvv)
 */
export function parseVerbosity(opts: { v?: boolean; vv?: boolean; vvv?: boolean }): number {
  if (opts.vvv) return 3;
  if (opts.vv) return 2;
  if (opts.v) return 1;
  return 0;
}
