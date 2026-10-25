import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
export default defineConfig({plugins:[react(),tailwindcss()],define:{'process.env.NODE_ENV':'"production"'},build:{outDir:'../portable-build',emptyOutDir:true,lib:{entry:'src/center/portable-preview.tsx',name:'CareDreamPreview',formats:['iife'],fileName:()=> 'preview.js'},cssCodeSplit:false}})
