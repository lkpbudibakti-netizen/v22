import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import ts from 'typescript';

export function evaluateExpression(expression:string, bindings:Record<string,unknown>={}) {
  const js=ts.transpileModule(`return (${expression});`,{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
  return new Function('React',...Object.keys(bindings),js)(React,...Object.values(bindings));
}
export function initializer(file:string,name:string):string {
  const ast=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let result='';
  function walk(n:ts.Node){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)result=n.initializer!.getText(ast);ts.forEachChild(n,walk);}walk(ast);
  assert(result,`${file}: missing ${name}`);return result;
}
export function appCallback(name:string,bindings:Record<string,unknown>) {return evaluateExpression(initializer('src/App.tsx',name),bindings);}
export function routeCallback(file:string,route:string,bindings:Record<string,unknown>) {
  const ast=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);let expression='';
  function visit(n:ts.Node){if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='post'&&n.arguments.length===2&&ts.isStringLiteral(n.arguments[0])&&n.arguments[0].text===route)expression=n.arguments[1].getText(ast);ts.forEachChild(n,visit);}visit(ast);
  assert(expression,'POST route '+route);return evaluateExpression(expression,bindings);
}
export function jsxCallback(component:string,attribute:string,bindings:Record<string,unknown>) {
  const ast=ts.createSourceFile('App.tsx',readFileSync('src/App.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const expressions:string[]=[];
  function walk(n:ts.Node){
    if((ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n))&&n.tagName.getText(ast)===component)for(const a of n.attributes.properties) {
      if(ts.isJsxAttribute(a)&&a.name.getText(ast)===attribute&&a.initializer&&ts.isJsxExpression(a.initializer)&&a.initializer.expression)expressions.push(a.initializer.expression.getText(ast));
    }
    ts.forEachChild(n,walk);
  }walk(ast);assert.equal(expressions.length,1,component+'.'+attribute);return evaluateExpression(expressions[0],bindings);
}
export function nodes(tree:any,predicate:(node:any)=>boolean):any[] {
  if(!tree||typeof tree!=='object')return [];
  return [...(predicate(tree)?[tree]:[]),...React.Children.toArray(tree.props?.children).flatMap(child=>nodes(child,predicate))];
}
export function byId(tree:any,id:string):any {const found=nodes(tree,n=>n.props?.id===id);assert.equal(found.length,1,id);return found[0];}
export function nodeText(node:any):string {
  if(typeof node==='string'||typeof node==='number')return String(node);
  return node?.props?React.Children.toArray(node.props.children).map(nodeText).join(' '):'';
}
export function inputForState(file:string,state:string,bindings:Record<string,unknown>) {
  const ast=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let element='';
  function walk(n:ts.Node){if(ts.isJsxSelfClosingElement(n)&&n.tagName.getText(ast)==='input'&&n.attributes.properties.some(a=>ts.isJsxAttribute(a)&&a.name.getText(ast)==='value'&&a.initializer&&ts.isJsxExpression(a.initializer)&&a.initializer.expression?.getText(ast)===state))element=n.getText(ast);ts.forEachChild(n,walk);}walk(ast);
  assert(element,'input bound to '+state);return evaluateExpression(element,bindings);
}
