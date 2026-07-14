import { axisBottom, axisLeft } from 'd3-axis';
import { scaleLinear } from 'd3-scale';
import { pointer, select } from 'd3-selection';
import { curveMonotoneX, line } from 'd3-shape';
import type { WinratePoint } from './analysis';

export class WinrateChart {
  private readonly container: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly tooltip: HTMLDivElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly onMoveSelected?: (moveNumber: number) => void;
  private points: WinratePoint[] = [];
  private showBlack = true;
  private showWhite = true;

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
    this.render();
  }

  upsert(point: WinratePoint): void {
    const existing = this.points.findIndex(item => item.moveNumber === point.moveNumber);
    if (existing >= 0) {
      this.points[existing] = point;
    } else {
      this.points.push(point);
    }
    this.points.sort((a, b) => a.moveNumber - b.moveNumber);
    this.render();
  }

  mergeMissing(points: WinratePoint[]): void {
    const existingMoves = new Set(this.points.map(point => point.moveNumber));
    this.points.push(...points.filter(point => !existingMoves.has(point.moveNumber)));
    this.points.sort((a, b) => a.moveNumber - b.moveNumber);
    this.render();
  }

  setSeriesVisibility(showBlack: boolean, showWhite: boolean): void {
    this.showBlack = showBlack;
    this.showWhite = showWhite;
    this.render();
  }

  private render(): void {
    this.tooltip.style.display = 'none';
    const width = Math.max(this.container.clientWidth, 260);
    const height = 180;
    const margin = { top: 12, right: 12, bottom: 28, left: 38 };
    const svg = select(this.svg)
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', '100%')
      .attr('height', height);

    svg.selectAll('*').remove();

    const maxMove = Math.max(1, ...this.points.map(point => point.moveNumber));
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

    if (this.showBlack) {
      svg.append('path')
        .datum(this.points)
        .attr('class', 'winrate-line winrate-line-black')
        .attr('d', blackLine);
    }

    if (this.showWhite) {
      svg.append('path')
        .datum(this.points)
        .attr('class', 'winrate-line winrate-line-white')
        .attr('d', whiteLine);
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
