import { describe, expect, it } from 'vitest';
import { parseMcpArguments, renderMcpHelp } from '../../../src/mcp/arguments.js';

describe('MCP startup arguments', () => {
  it('registers repeatable artifacts and an explicit named comparison pair', () => {
    expect(
      parseMcpArguments([
        '--analysis',
        'ticket=.api-intel/ticket-analysis.json',
        '--analysis',
        'worker=.api-intel/worker-analysis.json',
        '--system',
        'platform=.api-intel/system-analysis.json',
        '--policy',
        'architecture=.api-intel/policy-results.json',
        '--before',
        'baseline=.api-intel/before.json',
        '--after',
        'current=.api-intel/after.json',
      ]),
    ).toEqual({
      mode: 'serve',
      artifacts: [
        {
          role: 'analysis',
          name: 'ticket',
          path: '.api-intel/ticket-analysis.json',
        },
        {
          role: 'analysis',
          name: 'worker',
          path: '.api-intel/worker-analysis.json',
        },
        {
          role: 'system',
          name: 'platform',
          path: '.api-intel/system-analysis.json',
        },
        {
          role: 'policy',
          name: 'architecture',
          path: '.api-intel/policy-results.json',
        },
        { role: 'before', name: 'baseline', path: '.api-intel/before.json' },
        { role: 'after', name: 'current', path: '.api-intel/after.json' },
      ],
    });
  });

  it('keeps help and server version independent from artifact arguments', () => {
    expect(parseMcpArguments(['--help'])).toEqual({ mode: 'help' });
    expect(parseMcpArguments(['-v'])).toEqual({ mode: 'version' });
    expect(renderMcpHelp()).toContain('--before <name>=<analysis.json>');
    expect(renderMcpHelp()).toContain('--policy <name>=<policy-results.json>');
    expect(renderMcpHelp()).toContain('Before and after must be supplied together.');
  });

  it.each([
    { name: 'empty startup', args: [] },
    { name: 'missing after', args: ['--before', 'baseline=before.json'] },
    { name: 'missing before', args: ['--after', 'current=after.json'] },
    {
      name: 'duplicate name across roles',
      args: ['--analysis', 'current=analysis.json', '--system', 'current=system.json'],
    },
    { name: 'invalid name', args: ['--analysis', '../current=analysis.json'] },
    { name: 'missing path', args: ['--analysis', 'current='] },
    { name: 'missing name', args: ['--analysis', '=analysis.json'] },
    { name: 'positional input', args: ['analysis.json'] },
    { name: 'unknown option', args: ['--artifact', 'current=analysis.json'] },
    { name: 'help mixed with input', args: ['--help', '--analysis', 'current=analysis.json'] },
    { name: 'help and version mixed', args: ['--help', '--version'] },
  ])('rejects $name', ({ args }) => {
    expect(() => parseMcpArguments(args)).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENTS' }),
    );
  });
});
