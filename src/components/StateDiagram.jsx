// src/components/StateDiagram.jsx
import React, { useState } from 'react';

export default function StateDiagram({ matrix, stateNames }) {
  const [hoveredNode, setHoveredNode] = useState(null);
  
  const M = matrix.length;
  const width = 450;
  const height = 400;
  const centerX = width / 2;
  const centerY = height / 2;
  const circleRadius = 120; // Radius of the layout circle
  const nodeRadius = 38;    // Radius of individual state circles
  
  // Custom theme colors for nodes based on index
  const nodeColors = [
    { border: '#f43f5e', fill: 'rgba(244, 63, 94, 0.15)', text: '#f43f5e' }, // Bear / Low-Vol Bear
    { border: '#f59e0b', fill: 'rgba(245, 158, 11, 0.15)', text: '#f59e0b' },  // Neutral / High-Vol Bear
    { border: '#10b981', fill: 'rgba(16, 185, 129, 0.15)', text: '#10b981' },  // Bull / Low-Vol Bull
    { border: '#8b5cf6', fill: 'rgba(139, 92, 246, 0.15)', text: '#8b5cf6' },  // High-Vol Bull
  ];

  // Calculate coordinates for each node
  const nodes = [];
  for (let i = 0; i < M; i++) {
    // Offset by -PI/2 to start from top
    const angle = (2 * Math.PI * i) / M - Math.PI / 2;
    const x = centerX + circleRadius * Math.cos(angle);
    const y = centerY + circleRadius * Math.sin(angle);
    
    // Choose colors. If M is 3, map to 0 (Bear), 1 (Neutral), 2 (Bull).
    // If M is 4, maps 1-1 with Volatility regimes.
    const colorIndex = M === 3 && i === 2 ? 2 : i % nodeColors.length;
    
    nodes.push({
      id: i,
      name: stateNames[i],
      x,
      y,
      angle,
      style: nodeColors[colorIndex]
    });
  }

  // Draw self-loop path (cubic bezier)
  function drawSelfLoop(node) {
    const { x, y, angle } = node;
    const size = 55;
    
    // Calculate control points pushing outwards radially
    const cp1x = x + size * Math.cos(angle - 0.4);
    const cp1y = y + size * Math.sin(angle - 0.4);
    const cp2x = x + size * Math.cos(angle + 0.4);
    const cp2y = y + size * Math.sin(angle + 0.4);
    
    return `M ${x - 5} ${y - nodeRadius + 3} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x + 5} ${y - nodeRadius + 3}`;
  }

  // Draw arrow path between different nodes (quadratic bezier to create arc)
  function drawArc(fromNode, toNode) {
    const dx = toNode.x - fromNode.x;
    const dy = toNode.y - fromNode.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist === 0) return '';
    
    // Midpoint
    const mx = (fromNode.x + toNode.x) / 2;
    const my = (fromNode.y + toNode.y) / 2;
    
    // Normal vector
    const nx = -dy / dist;
    const ny = dx / dist;
    
    // Curve offset
    const offset = 22;
    const ctrlX = mx + nx * offset;
    const ctrlY = my + ny * offset;
    
    // Intersection point at target node border
    // Vector from control point to target node center
    const tdx = toNode.x - ctrlX;
    const tdy = toNode.y - ctrlY;
    const tdist = Math.sqrt(tdx * tdx + tdy * tdy);
    
    const targetBorderX = toNode.x - (tdx / tdist) * (nodeRadius + 6);
    const targetBorderY = toNode.y - (tdy / tdist) * (nodeRadius + 6);
    
    return {
      path: `M ${fromNode.x} ${fromNode.y} Q ${ctrlX} ${ctrlY} ${targetBorderX} ${targetBorderY}`,
      arrowTip: { x: targetBorderX, y: targetBorderY, ctrlX, ctrlY }
    };
  }

  return (
    <div className="state-diagram-wrapper" style={{ position: 'relative', width: '100%' }}>
      {/* SVG Canvas */}
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <defs>
          {/* Arrowhead marker definition */}
          {nodeColors.map((color, idx) => (
            <marker
              key={`arrow-${idx}`}
              id={`arrowhead-${idx}`}
              markerWidth="8"
              markerHeight="6"
              refX="6"
              refY="3"
              orientation="auto"
            >
              <polygon points="0 0, 8 3, 0 6" fill={color.border} />
            </marker>
          ))}
          {/* Default gray arrowhead marker */}
          <marker
            id="arrowhead-gray"
            markerWidth="8"
            markerHeight="6"
            refX="6"
            refY="3"
            orientation="auto"
          >
            <polygon points="0 0, 8 3, 0 6" fill="rgba(156, 163, 175, 0.4)" />
          </marker>
        </defs>

        {/* Transition Arrows */}
        {nodes.map(fromNode => {
          return nodes.map(toNode => {
            const prob = matrix[fromNode.id][toNode.id];
            if (prob < 0.02) return null; // Hide very low probability transitions for cleaner view
            
            const isSelf = fromNode.id === toNode.id;
            const isHoveredSrc = hoveredNode === fromNode.id;
            const isHoveredDest = hoveredNode === toNode.id;
            const isAnyHovered = hoveredNode !== null;
            
            // Highlight styling rules
            let strokeColor = 'rgba(255, 255, 255, 0.08)';
            let strokeWidth = 1 + prob * 5; // Thickness based on probability
            let markerId = 'arrowhead-gray';
            let opacity = 0.35;
            
            if (isAnyHovered) {
              if (isHoveredSrc) {
                // Highlight outgoing transitions
                strokeColor = fromNode.style.border;
                markerId = `arrowhead-${fromNode.id % nodeColors.length}`;
                opacity = 0.95;
                strokeWidth = 2 + prob * 6;
              } else if (isHoveredDest) {
                // Fade incoming transitions slightly less
                strokeColor = 'rgba(156, 163, 175, 0.7)';
                opacity = 0.6;
              } else {
                opacity = 0.08;
              }
            } else {
              // Standard state
              strokeColor = 'rgba(156, 163, 175, 0.25)';
              opacity = 0.6;
            }

            if (isSelf) {
              const pathStr = drawSelfLoop(fromNode);
              
              // Calculate label coordinate
              const labelX = fromNode.x + 55 * Math.cos(fromNode.angle);
              const labelY = fromNode.y + 55 * Math.sin(fromNode.angle);
              
              return (
                <g key={`self-${fromNode.id}`} style={{ transition: 'opacity 0.2s ease' }} opacity={opacity}>
                  <path
                    d={pathStr}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    markerEnd={`url(#${markerId})`}
                  />
                  {/* Transition Probability Text Label */}
                  <rect
                    x={labelX - 18}
                    y={labelY - 9}
                    width="36"
                    height="16"
                    rx="3"
                    fill="#0c101b"
                    stroke={strokeColor}
                    strokeWidth="0.5"
                  />
                  <text
                    x={labelX}
                    y={labelY + 3}
                    textAnchor="middle"
                    fill={isHoveredSrc ? '#fff' : '#9ca3af'}
                    fontSize="9px"
                    fontWeight="700"
                  >
                    {(prob * 100).toFixed(0)}%
                  </text>
                </g>
              );
            } else {
              const arcDetails = drawArc(fromNode, toNode);
              if (!arcDetails) return null;
              const { path, arrowTip } = arcDetails;
              
              // Find midpoint of bezier curve for text label
              const mx = (fromNode.x + toNode.x) / 2;
              const my = (fromNode.y + toNode.y) / 2;
              const dx = toNode.x - fromNode.x;
              const dy = toNode.y - fromNode.y;
              const dist = Math.sqrt(dx*dx + dy*dy);
              const nx = -dy / dist;
              const ny = dx / dist;
              // Text offset (slightly shifted from curve)
              const labelX = mx + nx * 18;
              const labelY = my + ny * 18;
              
              return (
                <g key={`arc-${fromNode.id}-${toNode.id}`} style={{ transition: 'opacity 0.2s ease' }} opacity={opacity}>
                  <path
                    d={path}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    markerEnd={`url(#${markerId})`}
                  />
                  {/* Probability label */}
                  <rect
                    x={labelX - 16}
                    y={labelY - 8}
                    width="32"
                    height="15"
                    rx="3"
                    fill="#0c101b"
                    stroke={strokeColor}
                    strokeWidth="0.5"
                  />
                  <text
                    x={labelX}
                    y={labelY + 3}
                    textAnchor="middle"
                    fill={isHoveredSrc ? '#fff' : '#9ca3af'}
                    fontSize="9px"
                    fontWeight="700"
                  >
                    {(prob * 100).toFixed(0)}%
                  </text>
                </g>
              );
            }
          });
        })}

        {/* State Nodes */}
        {nodes.map(node => {
          const isHovered = hoveredNode === node.id;
          const isAnyHovered = hoveredNode !== null;
          
          let opacity = 1.0;
          let scale = 1.0;
          let strokeWidth = 2;
          let glow = 'none';
          
          if (isAnyHovered) {
            if (isHovered) {
              scale = 1.08;
              strokeWidth = 3;
              glow = '0 0 10px rgba(255,255,255,0.2)';
            } else {
              opacity = 0.4;
            }
          }
          
          return (
            <g
              key={`node-${node.id}`}
              transform={`translate(${node.x}, ${node.y}) scale(${scale})`}
              style={{ cursor: 'pointer', transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)' }}
              opacity={opacity}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
            >
              {/* Glow filter backdrop */}
              <circle
                cx={0}
                cy={0}
                r={nodeRadius}
                fill={node.style.fill}
                stroke={node.style.border}
                strokeWidth={strokeWidth}
                style={{ filter: isHovered ? `drop-shadow(0px 0px 6px ${node.style.border})` : 'none' }}
              />
              {/* Text label */}
              <text
                x={0}
                y={-4}
                textAnchor="middle"
                fill="#fff"
                fontSize="10px"
                fontWeight="700"
                fontFamily="var(--font-heading)"
              >
                {node.name.split(' ')[0]}
              </text>
              <text
                x={0}
                y={8}
                textAnchor="middle"
                fill={node.style.border}
                fontSize="8px"
                fontWeight="600"
                fontFamily="var(--font-heading)"
                letterSpacing="0.05em"
              >
                {node.name.split(' ').slice(1).join(' ') || `STATE ${node.id}`}
              </text>
            </g>
          );
        })}
      </svg>
      
      {/* Floating Instructions Panel */}
      <div 
        style={{
          position: 'absolute',
          bottom: '10px',
          left: '10px',
          right: '10px',
          padding: '6px 12px',
          borderRadius: '6px',
          background: 'rgba(10, 15, 25, 0.85)',
          border: '1px solid var(--border-color)',
          fontSize: '10px',
          color: 'var(--text-muted)',
          textAlign: 'center',
          pointerEvents: 'none'
        }}
      >
        [INFO] Hover over any state circle to isolate its transition probabilities
      </div>
    </div>
  );
}
