import { describe, it, expect } from 'vitest';
import { extractManualSafetyStatement, ManualSafetyStatement } from './manual-safety-statement';

/**
 * Fixture: Real page text extracted from the 50 corpus pages.
 *
 * Safety pages (15 total):
 * - 12 carry manual markers (WARNING, ATTENTION, CAUTION, SHOCK HAZARD)
 * - 2 state the hazard in prose (GS10 p4, SMC50 p104)
 * - 1 (ACS355 p355) has no hazard statement
 *
 * Control pages (35 total):
 * - Only 3 carry markers: pf40-q3, ml1100-q2, smcflex-q2
 * - The other 32 must return null
 */

// Safety pages - should extract (14 of 15)
const SAFETY_FIXTURES = {
  // Pages with explicit WARNING/CAUTION/ATTENTION/SHOCK HAZARD markers
  'e3plus-q1': {
    text: `User Manual

E3 & E3 Plus Solid-State Overload Relay
Catalog Numbers 193/592-EC1, -EC2, -EC3, -EC5
Important User Information
Solid-state equipment has operational characteristics differing from those of electromechanical equipment. Safety
Guidelines for the Application, Installation and Maintenance of Solid State Controls (publication SGI-1.1 available from
your local Rockwell Automation sales office or online at http://www.rockwellautomation.com/literature/) describes some
important differences between solid-state equipment and hard-wired electromechanical devices. Because of this difference,
and also because of the wide variety of uses for solid-state equipment, all persons responsible for applying this equipment
must satisfy themselves that each intended application of this equipment is acceptable.

WARNING: Identifies information about practices or circumstances that can cause an explosion in a hazardous
environment, which may lead to personal injury or death, property damage, or economic loss.

ATTENTION: Identifies information about practices or circumstances that can lead to personal injury or death,
property damage, or economic loss.

SHOCK HAZARD: Labels may be on or inside the equipment, for example, a drive or motor, to alert people that
dangerous voltage may be present.

BURN HAZARD: Labels may be on or inside the equipment, for example, a drive or motor, to alert people that
surfaces may reach dangerous temperatures.`,
    expectedMarker: 'WARNING',
  },

  // Prose hazard: "wait at least N minutes" pattern
  'gs10-ch6-q4': {
    text: `Chapter 6: Maintenance and Troubleshooting

Recommended Inspection Schedules

Before the check-up, always turn off the AC input power and remove the cover. Wait at least
10 minutes after all display lamps have gone out, and then confirm that the capacitors have
fully discharged by measuring the voltage between DC+ and DC-. The voltage between DC+ and
DC- should be less than 25VDC.`,
    expectedMarker: 'WARNING (manual text)',
  },

  // Prose hazard: "hazardous voltages are present" pattern
  'smc50-q4': {
    text: `Chapter 4: Special Application Considerations

Isolation Contactor

When it is installed with branch circuit protection and an overcurrent device, the SMC-50
controller is compatible with the National Electrical Code (NEC). When an isolation contactor is
not used, hazardous voltages are present at the load terminals of the power module even when
the controller is turned off.`,
    expectedMarker: 'WARNING (manual text)',
  },

  // No hazard statement - should return null
  'acs355-q4': {
    text: `Fault tracing 355

CODE ALARM                    CAUSE                     WHAT TO DO
2035    SAFE TORQUE           STO (Safe torque off)     If this was not expected reaction to
        OFF                   requested and it          safety circuit interruption, check
        0309 bit 13           functions correctly.      cabling of safety circuit connected to
                              Parameter 3025 STO        STO terminals X1C.
                              OPERATION is set to       If different reaction is required, change
                              react with alarm.         value of parameter 3025 STO`,
    expectedMarker: null,
  },
};

// Control pages - only 3 should extract
const CONTROL_FIXTURES = {
  'pf40-q3': {
    // This should have a marker
    text: `Auto-Restart Function

WARNING: The auto-restart feature can cause unexpected equipment movement.
Ensure proper lockout/tagout procedures are followed during maintenance.
Never service equipment with auto-restart enabled.`,
    shouldExtract: true,
    expectedMarker: 'WARNING',
  },

  'ml1100-q2': {
    // This should have a marker
    text: `Battery Backup System

ATTENTION: Battery voltage can remain charged even after power-down.
Always verify safe discharge before maintenance work.`,
    shouldExtract: true,
    expectedMarker: 'ATTENTION',
  },

  'smcflex-q2': {
    // This should have a marker
    text: `Acceleration Ramp Configuration

CAUTION: Rapid acceleration can cause mechanical stress.
Configure safe acceleration rates for your application.`,
    shouldExtract: true,
    expectedMarker: 'CAUTION',
  },

  // Control pages that should NOT extract (sample)
  'pf40-q5': {
    text: `Technical Specifications

Model: PowerFlex 40
Input Voltage: 208-240V AC single phase
Output Current: 5A continuous rated
Weight: 2.5 kg
Operating Temperature: 0-50°C`,
    shouldExtract: false,
  },

  'micro820-um-q10': {
    text: `System Configuration Guide

The Micro820 PLC provides flexible I/O configuration.
Users can define analog inputs and outputs through the programming software.
Up to 16 I/O points can be configured per module.`,
    shouldExtract: false,
  },
};

describe('extractManualSafetyStatement', () => {
  describe('Safety Pages - Marker-based extraction', () => {
    it('should extract WARNING marker and statement', () => {
      const result = extractManualSafetyStatement(SAFETY_FIXTURES['e3plus-q1'].text);
      expect(result).not.toBeNull();
      expect(result!.marker).toBe('WARNING');
      expect(result!.statement).toContain('explosion');
    });
  });

  describe('Safety Pages - Prose fallback extraction', () => {
    it('should extract "wait at least N minutes" prose pattern from GS10', () => {
      const result = extractManualSafetyStatement(SAFETY_FIXTURES['gs10-ch6-q4'].text);
      expect(result).not.toBeNull();
      expect(result!.marker).toContain('WARNING');
      expect(result!.statement).toContain('10 minutes');
      expect(result!.statement).toContain('capacitors');
    });

    it('should extract "hazardous voltages present" prose pattern from SMC50', () => {
      const result = extractManualSafetyStatement(SAFETY_FIXTURES['smc50-q4'].text);
      expect(result).not.toBeNull();
      expect(result!.marker).toContain('WARNING');
      expect(result!.statement).toContain('hazardous voltages are present');
    });
  });

  describe('Safety Pages - No hazard statement', () => {
    it('should return null for ACS355 p355 (alarm 2035 STO with no hazard)', () => {
      const result = extractManualSafetyStatement(SAFETY_FIXTURES['acs355-q4'].text);
      expect(result).toBeNull();
    });
  });

  describe('Control Pages - Marker extraction', () => {
    it('should extract WARNING from pf40-q3 (auto-restart)', () => {
      const result = extractManualSafetyStatement(CONTROL_FIXTURES['pf40-q3'].text);
      expect(result).not.toBeNull();
      expect(result!.marker).toBe('WARNING');
      expect(result!.statement).toContain('auto-restart');
    });

    it('should extract ATTENTION from ml1100-q2 (battery)', () => {
      const result = extractManualSafetyStatement(CONTROL_FIXTURES['ml1100-q2'].text);
      expect(result).not.toBeNull();
      expect(result!.marker).toBe('ATTENTION');
      expect(result!.statement).toContain('Battery');
    });

    it('should extract CAUTION from smcflex-q2 (acceleration)', () => {
      const result = extractManualSafetyStatement(CONTROL_FIXTURES['smcflex-q2'].text);
      expect(result).not.toBeNull();
      expect(result!.marker).toBe('CAUTION');
      expect(result!.statement).toContain('acceleration');
    });
  });

  describe('Control Pages - Non-matching pages', () => {
    it('should return null for specs page (pf40-q5)', () => {
      const result = extractManualSafetyStatement(CONTROL_FIXTURES['pf40-q5'].text);
      expect(result).toBeNull();
    });

    it('should return null for config guide (micro820-um-q10)', () => {
      const result = extractManualSafetyStatement(CONTROL_FIXTURES['micro820-um-q10'].text);
      expect(result).toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('should return null for empty string', () => {
      const result = extractManualSafetyStatement('');
      expect(result).toBeNull();
    });

    it('should return null for null input', () => {
      const result = extractManualSafetyStatement(null as any);
      expect(result).toBeNull();
    });

    it('should return null for non-string input', () => {
      const result = extractManualSafetyStatement(123 as any);
      expect(result).toBeNull();
    });

    it('should handle marker at beginning of text', () => {
      const text = 'WARNING: High voltage present in this equipment.';
      const result = extractManualSafetyStatement(text);
      expect(result).not.toBeNull();
      expect(result!.marker).toBe('WARNING');
    });

    it('should handle multi-line statements', () => {
      const text = `This is safe text.
WARNING: Do not touch.
Follow lockout procedures.
Verify voltage before working.`;
      const result = extractManualSafetyStatement(text);
      expect(result).not.toBeNull();
      expect(result!.marker).toBe('WARNING');
    });

    it('should cap statement at ~400 chars on sentence boundary', () => {
      const longStatement = `WARNING: ${'This is a long statement. '.repeat(30)}`;
      const result = extractManualSafetyStatement(longStatement);
      expect(result).not.toBeNull();
      expect(result!.statement.length).toBeLessThanOrEqual(410);
      // Should end at a sentence boundary
      expect(/[.!?]$/.test(result!.statement) || result!.statement.endsWith('...')).toBe(true);
    });

    it('should collapse multiple whitespace', () => {
      const text = `WARNING:    Do  not   touch.
      Very     dangerous.`;
      const result = extractManualSafetyStatement(text);
      expect(result).not.toBeNull();
      expect(result!.statement).not.toContain('   ');
    });

    it('should handle case-insensitive prose patterns', () => {
      const text = `Important information: Always turn off power. Wait at least 5 minutes after power-down before proceeding.`;
      const result = extractManualSafetyStatement(text);
      expect(result).not.toBeNull();
      expect(result!.statement).toContain('5 minutes');
    });
  });

  describe('Marker specificity', () => {
    it('should match WARNING marker exactly', () => {
      const text = 'WARNING: Device is powered.';
      const result = extractManualSafetyStatement(text);
      expect(result!.marker).toBe('WARNING');
    });

    it('should match all defined markers', () => {
      const markers = ['WARNING', 'DANGER', 'CAUTION', 'ATTENTION', 'SHOCK HAZARD', 'BURN HAZARD'];
      markers.forEach((marker) => {
        const text = `${marker}: This is important.`;
        const result = extractManualSafetyStatement(text);
        expect(result).not.toBeNull();
        expect(result!.marker).toBe(marker);
      });
    });

    it('should not match marker in middle of word', () => {
      const text = 'The XWARNING system is disabled.';
      const result = extractManualSafetyStatement(text);
      expect(result).toBeNull();
    });
  });

  describe('Prose fallback specificity', () => {
    it('should require power-off context for "wait N minutes" pattern', () => {
      // Without power-off context
      const noContext = 'You must wait at least 5 minutes before starting.';
      const result1 = extractManualSafetyStatement(noContext);
      // Might still match, but with context it's more confident
      expect(result1).toBeNull();

      // With power-off context
      const withContext = 'Turn off power. Wait at least 5 minutes for discharge.';
      const result2 = extractManualSafetyStatement(withContext);
      expect(result2).not.toBeNull();
    });

    it('should match hazardous voltage pattern', () => {
      const text = 'When isolation is not used, hazardous voltages are present at all times.';
      const result = extractManualSafetyStatement(text);
      expect(result).not.toBeNull();
      expect(result!.statement).toContain('hazardous');
    });
  });

  describe('Marker anchoring (#4509 Codex F2)', () => {
    it('ignores a marker word embedded in ordinary prose', () => {
      expect(
        extractManualSafetyStatement('Parameter 42 displays the WARNING: ACTIVE status while the relay is energized.'),
      ).toBeNull();
    });

    it('still extracts an indented marker', () => {
      const result = extractManualSafetyStatement('      WARNING: Hazardous voltage.');
      expect(result).toEqual({ marker: 'WARNING', statement: 'Hazardous voltage.' });
    });

    it('still extracts a bullet- or icon-prefixed marker', () => {
      expect(extractManualSafetyStatement('• WARNING: Hazardous voltage.')?.marker).toBe('WARNING');
      expect(extractManualSafetyStatement('⚠ DANGER: Arc flash hazard.')?.marker).toBe('DANGER');
      expect(extractManualSafetyStatement('! CAUTION: Hot surface.')?.marker).toBe('CAUTION');
    });
  });

  describe('Marker followed by a layout gap (#4509 Codex r2 F2)', () => {
    it('skips blank layout lines after a standalone marker and keeps the statement', () => {
      expect(extractManualSafetyStatement('WARNING:\n\nHazardous voltage. Disconnect power before servicing.')).toEqual({
        marker: 'WARNING',
        statement: 'Hazardous voltage. Disconnect power before servicing.',
      });
    });

    it('a marker with no statement after it is not a safety statement', () => {
      expect(extractManualSafetyStatement('WARNING:\n\n')).toBeNull();
      expect(extractManualSafetyStatement('WARNING:')).toBeNull();
    });
  });
});

describe('#4509 Codex r5 F4 — an unpunctuated standalone marker line', () => {
  it.each([
    ['WARNING\nDisconnect all power before servicing.', 'WARNING'],
    ['DANGER\nHazardous voltage inside.', 'DANGER'],
    ['SHOCK HAZARD\nDo not touch the terminals while energized.', 'SHOCK HAZARD'],
    ['  ⚠ WARNING\n\nDisconnect all power before servicing.', 'WARNING'],
  ])('%j yields its statement', (text, marker) => {
    const r = extractManualSafetyStatement(text);
    expect(r?.marker).toBe(marker);
    expect(r?.statement).toBe(text.split('\n').filter((l) => l.trim()).slice(1).join(' ').trim());
  });
  it('a marker with no following statement still yields nothing', () => {
    expect(extractManualSafetyStatement('WARNING')).toBeNull();
    expect(extractManualSafetyStatement('WARNING\n\n\n\n')).toBeNull();
  });
  it('control: the marker word inside a longer token still does not count', () => {
    expect(extractManualSafetyStatement('WARNINGS\nSee chapter 2.')).toBeNull();
  });
});
