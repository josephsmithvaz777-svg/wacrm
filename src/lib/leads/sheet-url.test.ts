import { describe, expect, it } from 'vitest';
import {
  csvExportUrl,
  isGoogleSheetsHost,
  parseSheetUrl,
} from './sheet-url';

describe('parseSheetUrl', () => {
  it('reads id and gid from a standard edit URL', () => {
    expect(
      parseSheetUrl(
        'https://docs.google.com/spreadsheets/d/1AbCdefGhijkLmNopqRStuVwxyz0123456789ABC/edit?gid=0#gid=0',
      ),
    ).toEqual({
      spreadsheetId: '1AbCdefGhijkLmNopqRStuVwxyz0123456789ABC',
      sheetGid: '0',
      canonicalUrl:
        'https://docs.google.com/spreadsheets/d/1AbCdefGhijkLmNopqRStuVwxyz0123456789ABC/edit?gid=0',
    });
  });

  it('accepts a sharing URL without gid', () => {
    const parsed = parseSheetUrl(
      'https://docs.google.com/spreadsheets/d/1AbCdefGhijkLmNopqRStuVwxyz0123456789ABC/edit?usp=sharing',
    );
    expect(parsed?.spreadsheetId).toBe(
      '1AbCdefGhijkLmNopqRStuVwxyz0123456789ABC',
    );
    expect(parsed?.sheetGid).toBeNull();
  });

  it('rejects non-https and non-Google hosts', () => {
    expect(
      parseSheetUrl(
        'http://docs.google.com/spreadsheets/d/1AbCdefGhijkLmNopqRStuVwxyz0123456789ABC/edit',
      ),
    ).toBeNull();
    expect(
      parseSheetUrl(
        'https://evil.example/spreadsheets/d/1AbCdefGhijkLmNopqRStuVwxyz0123456789ABC/edit',
      ),
    ).toBeNull();
  });

  it('rejects a bare id that is too short', () => {
    expect(
      parseSheetUrl('https://docs.google.com/spreadsheets/d/short/edit'),
    ).toBeNull();
  });
});

describe('isGoogleSheetsHost', () => {
  it('allows only Google sheet hosts', () => {
    expect(isGoogleSheetsHost('docs.google.com')).toBe(true);
    expect(isGoogleSheetsHost('spreadsheets.google.com')).toBe(true);
    expect(isGoogleSheetsHost('google.com')).toBe(false);
  });
});

describe('csvExportUrl', () => {
  it('includes gid when present', () => {
    expect(csvExportUrl('abc123abc123abc123abc123abc123ab', '42')).toBe(
      'https://docs.google.com/spreadsheets/d/abc123abc123abc123abc123abc123ab/export?format=csv&gid=42',
    );
  });
});
