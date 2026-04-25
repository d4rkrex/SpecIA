/**
 * specia --list and --search discovery commands
 * 
 * REF: .specia/changes/cli-mcp2cli-redesign/spec.md REQ-3
 */

import { Command } from "commander";
import { table } from "../output.js";
import chalk from "chalk";

interface CommandInfo {
  name: string;
  description: string;
  phase?: string;
  dependencies?: string[];
}

const COMMANDS: CommandInfo[] = [
  // Core workflow
  { name: 'init', description: 'Initialize SpecIA in a project', phase: 'setup' },
  { name: 'propose', description: 'Create change proposal', phase: 'planning', dependencies: ['init'] },
  { name: 'spec', description: 'Write specifications with requirements', phase: 'planning', dependencies: ['propose'] },
  { name: 'design', description: 'Create architecture design (optional)', phase: 'planning', dependencies: ['propose'] },
  { name: 'review', description: 'Mandatory security review (STRIDE + abuse cases)', phase: 'security', dependencies: ['spec'] },
  { name: 'tasks', description: 'Generate implementation task checklist', phase: 'implementation', dependencies: ['spec', 'review'] },
  { name: 'audit', description: 'Mandatory post-implementation code audit', phase: 'security', dependencies: ['tasks'] },
  { name: 'done', description: 'Archive completed change', phase: 'completion', dependencies: ['audit'] },
  
  // Shortcuts
  { name: 'new', description: 'Shortcut for propose (alias)', phase: 'shortcuts' },
  { name: 'continue', description: 'Resume at next incomplete phase', phase: 'shortcuts' },
  { name: 'ff', description: 'Fast-forward all phases (propose → tasks)', phase: 'shortcuts' },
  
  // Security tools
  { name: 'debate', description: 'Multi-agent debate on security findings', phase: 'security' },
  { name: 'hook-install', description: 'Install Guardian pre-commit hook', phase: 'security' },
  { name: 'hook-uninstall', description: 'Remove Guardian pre-commit hook', phase: 'security' },
  { name: 'hook-status', description: 'Check Guardian hook installation', phase: 'security' },
  
  // Utilities
  { name: 'search', description: 'Search past specs and security findings', phase: 'utilities' },
  { name: 'stats', description: 'Show token usage and cost analytics', phase: 'utilities' },
  { name: 'status', description: 'Show current change status', phase: 'utilities' },
  { name: 'config', description: 'Manage SpecIA configuration', phase: 'utilities' },
];

export function registerListCommand(program: Command): void {
  program
    .option('--list', 'List all available commands')
    .option('--search <keyword>', 'Search commands by keyword')
    .option('--compact', 'Compact output (command names only)')
    .action((opts) => {
      if (opts.list) {
        listCommands(opts.compact);
      } else if (opts.search) {
        searchCommands(opts.search, opts.compact);
      }
    });
}

function listCommands(compact: boolean): void {
  if (compact) {
    // Compact mode: space-separated names
    const names = COMMANDS.map(c => c.name).join(' ');
    console.log(names);
    return;
  }
  
  // Table mode
  console.log(chalk.bold('📋 SpecIA Commands\n'));
  
  const phases = ['setup', 'planning', 'security', 'implementation', 'completion', 'shortcuts', 'utilities'];
  
  for (const phase of phases) {
    const phaseCommands = COMMANDS.filter(c => c.phase === phase);
    if (phaseCommands.length === 0) continue;
    
    console.log(chalk.cyan.bold(`\n${phase.toUpperCase()}`));
    
    const rows = phaseCommands.map(cmd => ({
      name: cmd.name,
      description: cmd.description,
      deps: cmd.dependencies ? cmd.dependencies.join(', ') : '-'
    }));
    
    table(
      [
        { header: 'Command', key: 'name', width: 20 },
        { header: 'Description', key: 'description', width: 50 },
        { header: 'Dependencies', key: 'deps', width: 20 }
      ],
      rows
    );
  }
  
  console.log(chalk.dim('\nRun specia <command> --help for detailed usage'));
}

function searchCommands(keyword: string, compact: boolean): void {
  const lowerKeyword = keyword.toLowerCase();
  const matches = COMMANDS.filter(cmd => 
    cmd.name.toLowerCase().includes(lowerKeyword) ||
    cmd.description.toLowerCase().includes(lowerKeyword)
  );
  
  if (matches.length === 0) {
    console.log(chalk.yellow(`No commands found matching '${keyword}'`));
    return;
  }
  
  if (compact) {
    const names = matches.map(c => c.name).join(' ');
    console.log(names);
    return;
  }
  
  console.log(chalk.bold(`🔍 Commands matching '${keyword}':\n`));
  
  const rows = matches.map(cmd => ({
    name: cmd.name,
    description: cmd.description,
    phase: cmd.phase || '-'
  }));
  
  table(
    [
      { header: 'Command', key: 'name', width: 20 },
      { header: 'Description', key: 'description', width: 50 },
      { header: 'Phase', key: 'phase', width: 15 }
    ],
    rows
  );
}
