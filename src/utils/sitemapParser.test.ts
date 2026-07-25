import { describe, it, expect } from 'vitest';
import { parseSitemap, filterSitemap } from './sitemapParser';

describe('Sitemap Parser (.hhc and .hhk)', () => {
  it('should parse simple table of contents with nested items', () => {
    const hhc = `
      <!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML//EN">
      <HTML>
      <BODY>
      <UL>
        <LI> <OBJECT type="text/sitemap">
          <param name="Name" value="Introduction">
          <param name="Local" value="intro.html">
        </OBJECT>
        <LI> <OBJECT type="text/sitemap">
          <param name="Name" value="Chapter 1">
          <param name="Local" value="chap1.html">
        </OBJECT>
        <UL>
          <LI> <OBJECT type="text/sitemap">
            <param name="Name" value="Section 1.1">
            <param name="Local" value="sec11.html">
          </OBJECT>
        </UL>
      </UL>
      </BODY>
      </HTML>
    `;

    const nodes = parseSitemap(hhc);
    expect(nodes.length).toBe(2);
    expect(nodes[0].name).toBe('Introduction');
    expect(nodes[0].local).toBe('intro.html');

    expect(nodes[1].name).toBe('Chapter 1');
    expect(nodes[1].local).toBe('chap1.html');
    expect(nodes[1].children).toBeDefined();
    expect(nodes[1].children!.length).toBe(1);
    expect(nodes[1].children![0].name).toBe('Section 1.1');
    expect(nodes[1].children![0].local).toBe('sec11.html');
  });

  it('should filter sitemap tree correctly', () => {
    const tree = [
      {
        name: 'Introduction',
        local: 'intro.html'
      },
      {
        name: 'Chapter 1',
        local: 'chap1.html',
        children: [
          {
            name: 'Section 1.1',
            local: 'sec11.html'
          },
          {
            name: 'Section 1.2',
            local: 'sec12.html'
          }
        ]
      }
    ];

    // Filter by 'Section 1.2'
    const filtered1 = filterSitemap(tree, 'Section 1.2');
    expect(filtered1.length).toBe(1);
    expect(filtered1[0].name).toBe('Chapter 1');
    expect(filtered1[0].children!.length).toBe(1);
    expect(filtered1[0].children![0].name).toBe('Section 1.2');

    // Filter by 'intro'
    const filtered2 = filterSitemap(tree, 'intro');
    expect(filtered2.length).toBe(1);
    expect(filtered2[0].name).toBe('Introduction');
  });
});
