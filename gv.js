const { connectToBrowser } = require('./go.js');
const fs = require('fs').promises;
const path = require('path');
const { mkdir } = require('fs').promises;

// ======== 搜索模板配置 ========
// 使用以下字母来表示模式：
// a - 表示0-9中的一个数字，所有a位置使用相同的数字
// b - 表示0-9中的一个数字，所有b位置使用相同的数字，且与a不同
// c - 表示0-9中的一个数字，所有c位置使用相同的数字，且与a、b不同
// d - 表示0-9中的一个数字，所有d位置使用相同的数字，且与a、b、c不同
// 8 - 固定数字8
// 其他数字 - 固定为该数字
// 例如：
// "abab888" - 会生成0101888, 0202888, ..., 9898888等
// "888abab" - 会生成8880101, 8880202, ..., 8889898等
// "aaaabbb" - 会生成0000111, 0000222, ..., 9999888等
const SEARCH_PATTERN = "abc3333"; // 在这里修改搜索模式

// 是否排除数字4（0表示排除，1表示包含）
const EXCLUDE_DIGIT_4_MODE = 0; // 0: 排除数字4, 1: 允许使用数字4

// 根据模板生成所有可能的数字组合
function getAllValidNumbers() {
    const pattern = SEARCH_PATTERN;
    const validNumbers = [];
    
    // 检查模板中使用了哪些字母
    const usedLetters = new Set();
    for (const char of pattern) {
        if (char >= 'a' && char <= 'd') {
            usedLetters.add(char);
        }
    }
    
    // 递归生成所有可能的组合
    generateCombinations(pattern, usedLetters, {}, validNumbers);
    
    return validNumbers;
}

// 递归函数，用于生成所有可能的组合
function generateCombinations(pattern, usedLetters, assignments, results, index = 0, usedDigits = new Set()) {
    // 如果所有字母都已经分配了数字，生成最终的数字组合
    if (index >= usedLetters.size) {
        let result = '';
        for (const char of pattern) {
            if (char >= 'a' && char <= 'd') {
                result += assignments[char];
            } else {
                result += char;
            }
        }
        results.push(result);
        return;
    }
    
    // 获取当前需要分配的字母
    const letter = String.fromCharCode('a'.charCodeAt(0) + index);
    if (!usedLetters.has(letter)) {
        // 如果模式中没有使用这个字母，跳到下一个
        generateCombinations(pattern, usedLetters, assignments, results, index + 1, usedDigits);
        return;
    }
    
    // 为当前字母尝试所有可能的数字（0-9）
    for (let digit = 0; digit <= 9; digit++) {
        // 如果设置了排除数字4(模式0)且当前数字是4，则跳过
        if (EXCLUDE_DIGIT_4_MODE === 0 && digit === 4) {
            continue;
        }
        
        if (!usedDigits.has(digit)) {
            // 分配这个数字给当前字母
            assignments[letter] = digit;
            usedDigits.add(digit);
            
            // 递归处理下一个字母
            generateCombinations(pattern, usedLetters, assignments, results, index + 1, usedDigits);
            
            // 回溯
            usedDigits.delete(digit);
            delete assignments[letter];
        }
    }
}

// 从数组中随机选择一个元素
function getRandomElement(array) {
    return array[Math.floor(Math.random() * array.length)];
}

// 从数组中移除指定元素
function removeElement(array, element) {
    const index = array.indexOf(element);
    if (index !== -1) {
        array.splice(index, 1);
    }
}

// 加载已搜索的数字组合
async function loadSearchedNumbers() {
    const exclude4Suffix = EXCLUDE_DIGIT_4_MODE === 0 ? '_no4' : '_with4';
    const fileName = `gv_searched_${SEARCH_PATTERN}${exclude4Suffix}.json`;
    try {
        const data = await fs.readFile(fileName, 'utf8');
        return new Set(JSON.parse(data));
    } catch (error) {
        return new Set(); // 如果文件不存在，返回空集合
    }
}

// 保存已搜索的数字组合
async function saveSearchedNumbers(searchedSet) {
    const exclude4Suffix = EXCLUDE_DIGIT_4_MODE === 0 ? '_no4' : '_with4';
    const fileName = `gv_searched_${SEARCH_PATTERN}${exclude4Suffix}.json`;
    await fs.writeFile(fileName, JSON.stringify(Array.from(searchedSet)));
}

// 加载剩余未搜索的数字
async function loadRemainingNumbers() {
    const allValid = getAllValidNumbers();
    const searched = await loadSearchedNumbers();
    return allValid.filter(num => !searched.has(num));
}

// 确保截图目录存在
async function ensureScreenshotDir() {
    const dirName = 'gv_screenshots';
    try {
        await fs.access(dirName);
    } catch (error) {
        // 目录不存在，创建它
        await mkdir(dirName, { recursive: true });
        console.log(`创建截图目录: ${dirName}`);
    }
    return dirName;
}

// 模拟人工输入
async function typeWithDelay(page, selector, text) {
    for (let i = 0; i < text.length; i++) {
        await page.getByRole('textbox', { name: selector }).type(text[i], { delay: 100 });
    }
}

async function runGoogleVoice(userId) {
    let browser, context, page;
    
    try {
        // 连接到 IX Browser
        console.log('正在连接浏览器...');
        ({ browser, context, page } = await connectToBrowser(userId));

        // 访问 Google Voice 注册页面
        console.log('正在访问 Google Voice 注册页面...');
        await page.goto('https://voice.google.com/signup');
        console.log('等待页面加载（5秒）...');
        await page.waitForTimeout(5000);

        // 加载剩余未搜索的数字
        let remainingNumbers = await loadRemainingNumbers();
        let searchedNumbers = await loadSearchedNumbers();
        
        console.log(`已搜索 ${searchedNumbers.size} 个数字，剩余 ${remainingNumbers.length} 个数字待搜索`);
        
        // 持续搜索直到所有数字都被搜索
        while (remainingNumbers.length > 0) {
            // 随机选择一个数字组合
            const currentNumber = getRandomElement(remainingNumbers);
            const searchTerm = currentNumber; // 已经是完整的搜索格式
            console.log(`搜索号码 ${searchTerm}...（剩余 ${remainingNumbers.length} 个组合）`);
            
            try {
                // 清空搜索框
                await page.getByRole('textbox', { name: 'Search by city or area code' }).click();
                await page.getByRole('textbox', { name: 'Search by city or area code' }).fill('');
                await page.waitForTimeout(500);
                
                // 模拟人工输入搜索词
                await typeWithDelay(page, 'Search by city or area code', searchTerm);
                
                // 等待搜索结果加载
                console.log('等待搜索结果加载...');
                await page.waitForTimeout(3000);
                
                // 确保截图目录存在
                const screenshotDir = await ensureScreenshotDir();
                
                // 检查是否出现"No Google Voice numbers are available"提示
                const noNumbersAvailable = await page.locator('text=No Google Voice numbers are available').count() > 0;
                
                if (noNumbersAvailable) {
                    console.log(`未找到可用号码，继续下一个搜索...`);
                } else {
                    // 找到了搜索结果（不是"No Google Voice numbers are available"）
                    console.log(`找到搜索结果，正在截图...`);
                    
                    // 生成截图文件名
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const screenshotFileName = path.join(screenshotDir, `${currentNumber}_${timestamp}.png`);
                    
                    // 截图保存
                    await page.screenshot({ path: screenshotFileName, fullPage: true });
                    console.log(`截图已保存到 ${screenshotFileName}`);
                    
                    // 记录到日志文件
                    const logEntry = `${new Date().toLocaleString()} - 搜索词: ${searchTerm} - 截图: ${screenshotFileName}\n`;
                    await fs.appendFile(path.join(screenshotDir, 'search_results.log'), logEntry);
                }
                
                // 标记当前数字为已搜索
                searchedNumbers.add(currentNumber);
                await saveSearchedNumbers(searchedNumbers);
                
                // 从剩余数字中移除当前数字
                removeElement(remainingNumbers, currentNumber);
                
            } catch (error) {
                console.error(`搜索 ${searchTerm} 时出错:`, error.message);
                console.error('搜索出错，停止脚本执行');
                process.exit(1); // 出错时停止脚本
            }
        }
        
        console.log('所有搜索已完成！');
        process.exit(0); // 搜索完成后结束脚本
    } catch (error) {
        console.error('执行过程中出错:', error);
        throw error;
    }
}

// 检查命令行参数
if (require.main === module) {
    const userId = process.argv[2];
    if (!userId) {
        console.error('请提供浏览器ID参数');
        console.error('使用方法: node gv.js 浏览器ID');
        console.error('示例: node gv.js 1003');
        process.exit(1);
    }

    console.log(`开始执行，浏览器ID: ${userId}`);
    runGoogleVoice(userId).catch(error => {
        console.error('脚本执行失败:', error);
        process.exit(1);
    });
}

module.exports = {
    runGoogleVoice
};

