// 真折射（Liquid Glass displacement）的 SVG filter 定义 —— 只挂一次，不随状态重渲染。
//
// 出处：rdev/liquid-glass-react（MIT License）src/index.tsx 的折射滤镜。参数逐条照搬：
//   <filter x="-35%" y="-35%" width="170%" height="170%" colorInterpolationFilters="sRGB">
//     feImage（位移贴图，100%×100%，preserveAspectRatio="xMidYMid slice"）
//     → feGaussianBlur stdDeviation="0.3"（原式 max(0.1, 0.5 - 2*0.1)）
//     → feDisplacementMap scale="25" xChannelSelector="R" yChannelSelector="B"
//   位移贴图语义（照原实现）：R = 1 - x/W（左→右递减）、B = 1 - y/H（上→下递减）、G = 0，
//   也就是一张「等比放大（lens）」的双线性位移场。
//
// 与原实现的两处刻意偏差（写在这里，免得后来人以为漏了）：
//   1. 不用那份 6KB base64 JPEG：改成两张单通道内联 SVG data-URI（R 横向线性渐变、B 纵向线性渐变，
//      各 256×256），用 feBlend mode="screen" 合成为同一位移场。语义等价、体积从 6KB 降到几百字节，
//      也不再是一团不可读的压缩噪声。
//   2. 省略三通道色散：原实现还额外做 R/G/B 三通道错位叠加，给玻璃边缘加色散。这里不做——
//      色散是纯装饰，却要多两三倍的滤镜通道开销（spec §2.4 性能预算）。
//
// 要调折射强度只改 DISPLACEMENT_SCALE（原实现默认 25）：1 = 不位移，越大越夸张。
//
// 性能护栏：组件无 props，且用 React.memo 包住；模块级常量元素只在加载时求值一次，
// 父组件（App）因状态更新重渲染时它连函数体都不会进。DOM 里永远只有一个 <svg>，
// width/height = 0 + position:absolute，不参与布局，也不占命中区域。

import { memo } from 'react'

/** 位移强度（feDisplacementMap scale）。原实现（liquid-glass-react）默认 25。 */
const DISPLACEMENT_SCALE = 25

/** 位移贴图边缘平滑（feGaussianBlur stdDeviation）。原实现 = max(0.1, 0.5 - 2*0.1) = 0.3。 */
const MAP_SMOOTH = 0.3

/** 单通道贴图的边长。原实现的 JPEG 也是 256 级别的方形贴图，配合 slice 铺满滤镜区域。 */
const MAP_SIZE = 256

// SVG 源码 → data-URI：必须整串 encodeURIComponent。'#' 不编码会被当成 URL 片段，
// fill="url(#r)" 里的 #r 就丢了，贴图直接变空白（位移就静默失效）。
function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function gradientMap(x1: number, y1: number, x2: number, y2: number, stop: string): string {
  return svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${MAP_SIZE}" height="${MAP_SIZE}">` +
      `<defs><linearGradient id="g" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">` +
      `<stop offset="0" stop-color="${stop}"/><stop offset="1" stop-color="#000000"/>` +
      `</linearGradient></defs>` +
      `<rect width="100%" height="100%" fill="url(#g)"/>` +
      `</svg>`,
  )
}

/** R 通道 = 1 - x/W：左红右黑（横向递减） */
const MAP_R = gradientMap(0, 0, 1, 0, '#ff0000')
/** B 通道 = 1 - y/H：上蓝下黑（纵向递减） */
const MAP_B = gradientMap(0, 0, 0, 1, '#0000ff')

// 模块级常量元素：import 时构造一次。React 会复用它，永远只挂一份。
const DEFS = (
  <svg
    width="0"
    height="0"
    aria-hidden="true"
    focusable="false"
    style={{ position: 'absolute', overflow: 'hidden', pointerEvents: 'none' }}
  >
    <filter
      id="pb-glass-refract"
      x="-35%"
      y="-35%"
      width="170%"
      height="170%"
      colorInterpolationFilters="sRGB"
    >
      <feImage
        href={MAP_R}
        x="0"
        y="0"
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid slice"
        result="mapR"
      />
      <feImage
        href={MAP_B}
        x="0"
        y="0"
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid slice"
        result="mapB"
      />
      {/* 两个单通道贴图按 screen 叠加：R/B 各自保留，G 仍为 0（与原 JPEG 同一位移场） */}
      <feBlend in="mapR" in2="mapB" mode="screen" result="map" />
      <feGaussianBlur in="map" stdDeviation={MAP_SMOOTH} result="mapSmooth" />
      <feDisplacementMap
        in="SourceGraphic"
        in2="mapSmooth"
        scale={DISPLACEMENT_SCALE}
        xChannelSelector="R"
        yChannelSelector="B"
      />
    </filter>
  </svg>
)

export const GlassDefs = memo(function GlassDefs() {
  return DEFS
})
