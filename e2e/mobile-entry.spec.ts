import {test,expect} from '@playwright/test'
import {loginCare,resetDemo} from './helpers'
test('font enlargement and keyboard viewport allow scroll without covering submission',async({page})=>{
 await resetDemo(page);await page.setViewportSize({width:360,height:640});await loginCare(page,'c1')
 await page.addStyleTag({content:'.care-shell p,.care-shell button,.care-shell span,.care-shell h1 {font-size:1.5em !important} '})
 await page.getByRole('button',{name:'글로 입력하기',exact:true}).click()
 await page.setViewportSize({width:360,height:360})
 const editor=page.getByRole('textbox',{name:'오늘의 돌봄 이야기'});await editor.fill('식사를 적게 드셨어요');await editor.focus()
 const send=page.getByRole('button',{name:'이야기 전달하기',exact:true})
 expect(await send.evaluate(e=>getComputedStyle(e).position)).toBe('static')
 await send.scrollIntoViewIfNeeded();await expect(send).toBeInViewport();await send.click()
 await expect(page.getByTestId('current-question')).toBeVisible()
})
