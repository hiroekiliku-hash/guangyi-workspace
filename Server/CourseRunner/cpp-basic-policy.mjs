// This is a curriculum profile, not a replacement for the container boundary.
export const cppBasicHeaders = Object.freeze(['iostream','iomanip','string','sstream','vector','array','algorithm','numeric','limits','cmath','cctype','cstring','cstdio','cstdlib','climits','cfloat','cstdint','cstddef','utility']);
export function checkCPPBasicSource(source) {
  if (typeof source !== 'string' || !source.trim() || source.length > 40000) return '源码为空或超过长度限制。';
  const input=source.replace(/\\\r?\n/g,''), out=[], visible=[];let i=0;
  // Preserve newlines while removing comments and literals before policy checks.
  const mask = text => text.replace(/[^\r\n]/g,' ');
  while(i<input.length){
    const rest=input.slice(i);
    if(rest.startsWith('//')){const end=input.indexOf('\n',i);const j=end<0?input.length:end;out.push(mask(input.slice(i,j)));visible.push(mask(input.slice(i,j)));i=j;continue;}
    if(rest.startsWith('/*')){const end=input.indexOf('*/',i+2);const j=end<0?input.length:end+2;out.push(mask(input.slice(i,j)));visible.push(mask(input.slice(i,j)));i=j;continue;}
    const raw=/^(?:u8|u|U|L)?R"([^ ()\\\t\r\n]{0,16})\(/.exec(rest);
    if(raw){const end=input.indexOf(')'+raw[1]+'"',i+raw[0].length);const j=end<0?input.length:end+raw[1].length+2;out.push(mask(input.slice(i,j)));visible.push(input.slice(i,j));i=j;continue;}
    if(/[0-9]/.test(input[i])){const start=i++;while(i<input.length&&/[A-Za-z0-9_'.]/.test(input[i]))i++;out.push(input.slice(start,i));visible.push(input.slice(start,i));continue;}
    if(input[i]==='"'||input[i]==="'") {const quote=input[i],start=i++;while(i<input.length){if(input[i]==='\\'){i+=2;continue;}if(input[i++]===quote)break;}out.push(mask(input.slice(start,i)));visible.push(input.slice(start,i));continue;}
    visible.push(input[i]);out.push(input[i++]);
  }
  const code=out.join('');
  if(/%:|\?\?=|##|\\[uU][0-9a-fA-F]/.test(code))return '不支持替代预处理符号、标识符转义或宏拼接。';
  // Check directive structure against comment-stripped original: include names
  // must remain visible, while directives inside literals remain masked in code.
  const lines=code.split(/\r\n|\r|\n/), original=visible.join('').split(/\r\n|\r|\n/);
  for(let n=0;n<lines.length;n++){
    const directive=/^\s*#\s*([A-Za-z_][A-Za-z_0-9]*)\b/.exec(lines[n]);
    if(!directive){if(/^\s*#/.test(lines[n]))return '不支持此预处理指令。';continue;}
    if(directive[1]==='include'){
      const header=/^\s*#\s*include\s*<([a-z0-9]+)>\s*$/.exec(original[n]);
      if(!header||!cppBasicHeaders.includes(header[1]))return '仅允许公布的基础标准库头文件；请使用 #include <iostream> 等字面形式。';
    }else if(!['define','undef','if','ifdef','ifndef','elif','else','endif','error'].includes(directive[1]))return '不支持此预处理指令。';
  }
  if(/\b(?:asm|__asm|__asm__|system|popen|fork|vfork|exec[lv][pe]?|execve|dlopen|dlsym|ptrace|syscall|_Pragma|__has_include|__has_include_next)\b/.test(code))return '考试练习不开放汇编、进程、动态加载、系统调用或调试功能。';
  return null;
}
