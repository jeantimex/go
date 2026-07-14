import { axisBottom, axisLeft } from 'd3-axis';
import { scaleLinear } from 'd3-scale';
import { pointer, select } from 'd3-selection';
import { curveMonotoneX, line } from 'd3-shape';
import type { WinratePoint } from './analysis';

let chartId = 0;

export class WinrateChart {
  private readonly container: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly tooltip: HTMLDivElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly onMoveSelected?: (moveNumber: number) => void;
  private readonly lineClipId = `winrate-line-clip-${++chartId}`;
  private points: WinratePoint[] = [];
  private showBlack = true;
  private showWhite = true;
  private animateFromMove: number | null = null;
  private animationFrame: number | null = null;
  private xDomainMax = 50;

  constructor(container: HTMLElement, onMoveSelected?: (moveNumber: number) => void) {
    this.container = container;
    this.onMoveSelected = onMoveSelected;
    this.svg = select(container)
      .append('svg')
      .attr('role', 'img')
      .attr('aria-label', 'Black and White win rate by move')
      .node()!;
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'winrate-tooltip';
    this.tooltip.setAttribute('role', 'status');
    container.appendChild(this.tooltip);

    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(container);
    this.render();
  }

  clear(): void {
    this.points = [];
    this.animateFromMove = null;
    this.xDomainMax = 50;
    this.render();
  }

  upsert(point: WinratePoint, replaceExisting = true): void {
    const previousMaxMove = this.points.length > 0
      ? Math.max(...this.points.map(item => item.moveNumber))
      : null;
    const existing = this.points.findIndex(item => item.moveNumber === point.moveNumber);
    if (existing >= 0) {
      // Undo/replay may request the same historical position again. Keep the
      // strongest result instead of replacing it with an equal- or lower-visit
      // live estimate, which would make established history visibly drift.
      if (!replaceExisting || point.visits <= this.points[existing].visits) return;
      this.points[existing] = point;
    } else {
      this.points.push(point);
    }
    this.animateFromMove = existing < 0
      && previousMaxMove !== null
      && point.moveNumber > previousMaxMove
      ? previousMaxMove
      : null;
    if (point.moveNumber > this.xDomainMax) {
      this.xDomainMax = Math.ceil(point.moveNumber / 50) * 50;
    }
    this.points.sort((a, b) => a.moveNumber - b.moveNumber);
    this.render();
  }

  mergeMissing(points: WinratePoint[]): void {
    this.animateFromMove = null;
    const existingMoves = new Set(this.points.map(point => point.moveNumber));
    this.points.push(...points.filter(point => !existingMoves.has(point.moveNumber)));
    this.points.sort((a, b) => a.moveNumber - b.moveNumber);
    const latestMove = Math.max(0, ...this.points.map(point => point.moveNumber));
    this.xDomainMax = Math.max(50, Math.ceil(latestMove / 50) * 50);
    this.render();
  }

  truncateAfter(moveNumber: number): void {
    this.animateFromMove = null;
    this.points = this.points.filter(point => point.moveNumber <= moveNumber);
    this.xDomainMax = Math.max(50, Math.ceil(moveNumber / 50) * 50);
    this.render();
  }

  setSeriesVisibility(showBlack: boolean, showWhite: boolean): void {
    this.animateFromMove = null;
    this.showBlack = showBlack;
    this.showWhite = showWhite;
    this.render();
  }

  private render(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    const animationFromMove = this.animateFromMove;
    this.animateFromMove = null;
    this.tooltip.style.display = 'none';
    const width = Math.max(this.container.clientWidth, 260);
    const height = 180;
    const margin = { top: 12, right: 12, bottom: 28, left: 38 };
    const svg = select(this.svg)
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', '100%')
      .attr('height', height);

    svg.selectAll('*').remove();

    const latestMove = Math.max(0, ...this.points.map(point => point.moveNumber));
    const maxMove = Math.max(1, this.xDomainMax, latestMove);
    const x = scaleLinear()
      .domain([0, maxMove])
      .range([margin.left, width - margin.right]);
    const y = scaleLinear()
      .domain([0, 100])
      .range([height - margin.bottom, margin.top]);

    svg.append('line')
      .attr('class', 'winrate-even-line')
      .attr('x1', margin.left)
      .attr('x2', width - margin.right)
      .attr('y1', y(50))
      .attr('y2', y(50));

    svg.append('g')
      .attr('class', 'winrate-axis')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .call(axisBottom(x).ticks(Math.min(6, maxMove)).tickFormat(value => `${value}`));

    svg.append('g')
      .attr('class', 'winrate-axis')
      .attr('transform', `translate(${margin.left},0)`)
      .call(axisLeft(y).tickValues([0, 25, 50, 75, 100]).tickFormat(value => `${value}%`));

    if (this.points.length === 0) {
      svg.append('text')
        .attr('class', 'winrate-empty')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .text('Analyze a position to build the chart');
      return;
    }

    const blackLine = line<WinratePoint>()
      .x(point => x(point.moveNumber))
      .y(point => y(point.winrate * 100))
      .curve(curveMonotoneX);

    const whiteLine = line<WinratePoint>()
      .x(point => x(point.moveNumber))
      .y(point => y((1 - point.winrate) * 100))
      .curve(curveMonotoneX);

    const animateGrowth = animationFromMove !== null
      && animationFromMove < latestMove
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let clipRect: SVGRectElement | null = null;
    if (animateGrowth) {
      clipRect = svg.append('defs')
        .append('clipPath')
        .attr('id', this.lineClipId)
        .append('rect')
        .attr('x', margin.left)
        .attr('y', margin.top - 4)
        .attr('width', Math.max(0, x(animationFromMove) - margin.left))
        .attr('height', height - margin.top - margin.bottom + 8)
        .node();
    }

    if (this.showBlack) {
      const path = svg.append('path')
        .datum(this.points)
        .attr('class', 'winrate-line winrate-line-black')
        .attr('d', blackLine);
      if (animateGrowth) path.attr('clip-path', `url(#${this.lineClipId})`);
    }

    if (this.showWhite) {
      const path = svg.append('path')
        .datum(this.points)
        .attr('class', 'winrate-line winrate-line-white')
        .attr('d', whiteLine);
      if (animateGrowth) path.attr('clip-path', `url(#${this.lineClipId})`);
    }

    if (animateGrowth && clipRect) {
      const initialWidth = Math.max(0, x(animationFromMove) - margin.left);
      const finalWidth = Math.max(initialWidth, x(latestMove) - margin.left);
      const duration = 320;
      const startedAt = performance.now();
      const animate = (now: number): void => {
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        clipRect!.setAttribute('width', String(initialWidth + (finalWidth - initialWidth) * eased));
        if (progress < 1) {
          this.animationFrame = requestAnimationFrame(animate);
        } else {
          this.animationFrame = null;
        }
      };
      this.animationFrame = requestAnimationFrame(animate);
    }

    const hoverLine = svg.append('line')
      .attr('class', 'winrate-hover-line')
      .attr('y1', margin.top)
      .attr('y2', height - margin.bottom)
      .style('display', 'none');

    const showHover = (event: PointerEvent): void => {
      const [pointerX] = pointer(event, this.svg);
      const targetMove = x.invert(pointerX);
      const point = this.points.reduce((closest, candidate) =>
        Math.abs(candidate.moveNumber - targetMove) < Math.abs(closest.moveNumber - targetMove)
          ? candidate
          : closest
      );
      const lineX = x(point.moveNumber);
      const black = point.winrate * 100;
      const white = 100 - black;

      hoverLine
        .attr('x1', lineX)
        .attr('x2', lineX)
        .style('display', null);

      this.tooltip.innerHTML = `
        <strong>Move ${point.moveNumber}</strong>
        <span><i class="black"></i>Black ${black.toFixed(1)}%</span>
        <span><i class="white"></i>White ${white.toFixed(1)}%</span>
      `;
      this.tooltip.style.display = 'flex';

      const tooltipWidth = 116;
      const tooltipLeft = Math.min(
        Math.max(lineX + 8, margin.left),
        width - margin.right - tooltipWidth
      );
      this.tooltip.style.left = `${tooltipLeft}px`;
      this.tooltip.style.top = `${margin.top + 4}px`;
    };

    svg.append('rect')
      .attr('class', 'winrate-hover-target')
      .attr('x', margin.left)
      .attr('y', margin.top)
      .attr('width', width - margin.left - margin.right)
      .attr('height', height - margin.top - margin.bottom)
      .on('pointermove', showHover)
      .on('pointerleave', () => {
        hoverLine.style('display', 'none');
        this.tooltip.style.display = 'none';
      })
      .on('click', (event: PointerEvent) => {
        showHover(event);
        const [pointerX] = pointer(event, this.svg);
        const targetMove = x.invert(pointerX);
        const point = this.points.reduce((closest, candidate) =>
          Math.abs(candidate.moveNumber - targetMove) < Math.abs(closest.moveNumber - targetMove)
            ? candidate
            : closest
        );
        this.onMoveSelected?.(point.moveNumber);
      });
  }
}
