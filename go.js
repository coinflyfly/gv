const axios = require('axios').default;
const { chromium } = require('playwright');

// BitBrowser API 配置
const baseURL = 'http://127.0.0.1:54345';

// 创建axios实例
const request = axios.create({
  baseURL,
  timeout: 0
});

// 响应拦截器
request.interceptors.response.use(
  response => {
    if (response.status === 200) {
      return response.data;
    } else {
      console.log('请求失败，检查网络');
      return Promise.reject(new Error('请求失败，检查网络'));
    }
  },
  error => {
    console.error('请求失败了', error.message);
    return Promise.reject(error);
  }
);

// 上次API请求的时间戳
let lastRequestTime = 0;

/**
 * 添加请求延迟，确保API调用频率不超过限制
 * @param {number} minDelay - 最小延迟时间（毫秒）
 * @returns {Promise<void>}
 */
async function ensureRequestDelay(minDelay = 600) {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  
  if (elapsed < minDelay) {
    const delay = minDelay - elapsed;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  lastRequestTime = Date.now();
}

/**
 * 发送API请求，自动处理频率限制
 * @param {Object} options - 请求选项
 * @returns {Promise<any>} 响应数据
 */
async function sendRequest(options) {
  await ensureRequestDelay();
  return request(options);
}

/**
 * 获取浏览器列表
 * @returns {Promise<Array>} 浏览器列表
 */
async function getBrowserList() {
  try {
    // 使用标准端点
    const response = await sendRequest({
      method: 'post',
      url: '/browser/list',
      data: {
        page: 0,
        pageSize: 100
      }
    });
    
    if (response.success && response.data && response.data.list) {
      return response.data.list;
    }
    
    return [];
  } catch (error) {
    console.error('获取浏览器列表失败:', error.message);
    return [];
  }
}

/**
 * 根据序号或位置获取浏览器UUID
 * @param {number} index - 浏览器序号或位置索引
 * @returns {Promise<string|null>} 返回浏览器UUID，如果未找到返回null
 */
async function getBrowserIdByIndex(index) {
  try {
    const browsers = await getBrowserList();
    
    if (browsers.length === 0) {
      console.log('未找到任何浏览器配置');
      return null;
    }
    
    // 首先尝试通过seq字段匹配
    const browserBySeq = browsers.find(b => b.seq === Number(index));
    if (browserBySeq) {
      console.log(`找到序号 ${index} 对应的浏览器ID: ${browserBySeq.id}`);
      return browserBySeq.id;
    }
    
    // 如果没找到，尝试将index作为数组索引
    if (index > 0 && index <= browsers.length) {
      const browser = browsers[index - 1]; // 转换为0基索引
      if (browser) {
        console.log(`使用位置 ${index} 找到浏览器ID: ${browser.id}`);
        return browser.id;
      }
    }
    
    // 如果index是1且只有一个浏览器，直接返回第一个
    if (index === 1 && browsers.length === 1) {
      console.log(`只有一个浏览器配置，使用ID: ${browsers[0].id}`);
      return browsers[0].id;
    }
    
    console.log(`未找到序号或位置 ${index} 对应的浏览器`);
    return null;
  } catch (error) {
    console.error('根据序号查找浏览器失败:', error.message);
    return null;
  }
}

/**
 * 根据UUID获取浏览器的序号(seq)
 * @param {string} uuid - 浏览器UUID
 * @returns {Promise<number|null>} 返回浏览器序号，如果未找到返回null
 */
async function getBrowserSeq(uuid) {
  try {
    const response = await sendRequest({
      url: '/browser/detail',
      method: 'post',
      data: { id: uuid }
    });
    
    if (response.success && response.data && response.data.seq) {
      return response.data.seq;
    }
    return null;
  } catch (error) {
    console.error('获取浏览器序号失败:', error.message);
    return null;
  }
}

/**
 * 检查浏览器配置是否已经打开
 * @param {string} profileId - BitBrowser配置ID
 * @returns {Promise<string|null>} 返回ws地址，如果未打开返回null
 */
async function getActiveWs(profileId) {
  try {
    // 获取所有活跃浏览器的PID
    const response = await sendRequest({
      url: '/browser/pids/all',
      method: 'post'
    });
    
    if (response.success && response.data) {
      // 检查data是否是对象，如果是，尝试从对象中找到匹配的ID
      if (typeof response.data === 'object' && !Array.isArray(response.data)) {
        if (response.data[profileId]) {
          // 如果找到了匹配的ID，尝试获取详细信息
          const detailResponse = await sendRequest({
            url: '/browser/detail',
            method: 'post',
            data: { id: profileId }
          });
          
          if (detailResponse.success && detailResponse.data && detailResponse.data.ws) {
            return detailResponse.data.ws;
          }
        }
      } else {
        // 如果data是数组，按原来的逻辑处理
        const browsers = Array.isArray(response.data) ? response.data : [];
        const browser = browsers.find(b => b.id === profileId || b.browserId === profileId);
        if (browser && browser.ws) {
          return browser.ws;
        }
      }
      
      // 如果没找到，尝试获取浏览器详情
      try {
        const detailResponse = await sendRequest({
          url: '/browser/detail',
          method: 'post',
          data: { id: profileId }
        });
        
        if (detailResponse.success && detailResponse.data && detailResponse.data.ws) {
          return detailResponse.data.ws;
        }
      } catch (detailError) {
        // 忽略错误
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * 连接到浏览器
 * @param {string|number} userId - BitBrowser配置ID或序号
 * @returns {Promise<{browser: Browser, context: BrowserContext, page: Page}>} 返回浏览器实例、上下文和页面
 */
async function connectToBrowser(userId) {
  try {
    // 如果是数字，尝试查找对应的UUID
    let profileId = userId;
    
    if (!isNaN(Number(userId))) {
      // 如果是数字，可能是序号或位置索引
      const uuid = await getBrowserIdByIndex(Number(userId));
      if (uuid) {
        profileId = uuid;
      } else {
        // 如果找不到对应的浏览器，尝试列出所有浏览器
        const browsers = await getBrowserList();
        if (browsers.length > 0) {
          console.log('可用的浏览器配置:');
          browsers.forEach((b, index) => {
            console.log(`位置: ${index + 1}, ID: ${b.id}, 序号: ${b.seq || '未知'}, 名称: ${b.name || '(无名称)'}`);
          });
          throw new Error(`未找到序号 ${userId} 对应的浏览器配置，请使用上面列出的ID或位置`);
        } else {
          throw new Error('未找到任何浏览器配置，请确认比特浏览器已安装并创建了浏览器配置');
        }
      }
    }
    
    console.log(`正在连接浏览器...`);
    
    // 先检查是否已经有打开的浏览器
    let ws = await getActiveWs(profileId);
    
    // 如果没有打开的浏览器，则打开新的
    if (!ws) {
      console.log('浏览器未打开，正在启动浏览器...');
      
      try {
        const openData = {
          id: profileId,
          loadExtensions: true
        };
        
        const response = await sendRequest({
          method: 'post',
          url: '/browser/open',
          data: openData
        });

        if (!response.success) {
          throw new Error(`打开浏览器失败: ${response.msg || '未知错误'}`);
        }

        ws = response.data.ws;
        
        // 等待浏览器启动
        console.log('浏览器启动中，请稍候...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // 如果没有获取到ws，再次尝试获取
        if (!ws) {
          ws = await getActiveWs(profileId);
          if (!ws) {
            throw new Error('无法获取浏览器WebSocket地址');
          }
        }
      } catch (openError) {
        console.error('打开浏览器失败:', openError.message);
        throw openError;
      }
    } else {
      console.log('浏览器已打开，正在连接...');
    }

    // 连接到浏览器
    const browser = await chromium.connectOverCDP(ws);
    const context = await browser.contexts()[0];
    const pages = await context.pages();

    // 获取第一个页面或创建新页面
    let page = pages[0];
    if (!page) {
      page = await context.newPage();
    }

    console.log('浏览器连接成功');
    return { browser, context, page };
  } catch (error) {
    console.error('连接浏览器失败:', error.message);
    throw error;
  }
}

/**
 * 打开指定的 BitBrowser 配置
 * @param {string|number} userId - BitBrowser 配置ID或序号
 * @param {Object} options - 浏览器选项
 * @returns {Promise<void>}
 */
async function openBrowser(userId, options = {}) {
  try {
    // 如果是数字，尝试查找对应的UUID
    let profileId = userId;
    
    if (!isNaN(Number(userId))) {
      // 如果是数字，可能是序号或位置索引
      const uuid = await getBrowserIdByIndex(Number(userId));
      if (uuid) {
        profileId = uuid;
      } else {
        // 列出所有浏览器
        const browsers = await getBrowserList();
        if (browsers.length > 0) {
          console.log('可用的浏览器配置:');
          browsers.forEach((b, index) => {
            console.log(`位置: ${index + 1}, ID: ${b.id}, 序号: ${b.seq || '未知'}, 名称: ${b.name || '(无名称)'}`);
          });
          throw new Error(`未找到序号 ${userId} 对应的浏览器配置，请使用上面列出的ID或位置`);
        } else {
          throw new Error('未找到任何浏览器配置，请确认比特浏览器已安装并创建了浏览器配置');
        }
      }
    }

    // 检查是否已经打开
    const ws = await getActiveWs(profileId);
    if (ws) {
      console.log('浏览器已经处于打开状态');
      return;
    }

    console.log('正在打开浏览器...');
    
    const data = {
      id: profileId,
      loadExtensions: options.loadExtensions !== false,
      args: options.args || []
    };
    
    if (options.extractIp !== undefined) {
      data.extractIp = options.extractIp;
    }

    const response = await sendRequest({
      method: 'post',
      url: '/browser/open',
      data
    });

    if (!response.success) {
      throw new Error(`打开浏览器失败: ${response.msg || '未知错误'}`);
    }

    console.log('浏览器启动成功');
    await new Promise(resolve => setTimeout(resolve, 5000)); // 等待浏览器完全启动
    openBrowsers.add(profileId);
  } catch (error) {
    console.error('打开浏览器失败:', error.message);
    throw error;
  }
}

/**
 * 关闭指定的浏览器配置
 * @param {string|number} userId - BitBrowser配置ID或序号
 * @returns {Promise<void>}
 */
async function closeBrowser(userId) {
  try {
    // 如果是数字，尝试查找对应的UUID
    let profileId = userId;
    
    if (!isNaN(Number(userId))) {
      // 如果是数字，可能是序号或位置索引
      const uuid = await getBrowserIdByIndex(Number(userId));
      if (uuid) {
        profileId = uuid;
      } else {
        throw new Error(`未找到序号 ${userId} 对应的浏览器配置`);
      }
    }
    
    console.log(`正在关闭浏览器...`);

    const response = await sendRequest({
      method: 'post',
      url: '/browser/close',
      data: { id: profileId }
    });
    
    if (response.success) {
      openBrowsers.delete(profileId);
      console.log('浏览器已关闭');
    } else {
      console.error(`关闭浏览器失败: ${response.msg || '未知错误'}`);
    }
  } catch (error) {
    console.error('关闭浏览器失败:', error.message);
  }
}

/**
 * 列出所有浏览器配置
 * @returns {Promise<void>}
 */
async function listBrowsers() {
  try {
    const browsers = await getBrowserList();
    if (browsers.length === 0) {
      console.log('未找到任何浏览器配置');
      return;
    }
    
    console.log('浏览器配置列表:');
    browsers.forEach((browser, index) => {
      console.log(`位置: ${index + 1}, ID: ${browser.id}, 序号: ${browser.seq || '未知'}, 名称: ${browser.name || '(无名称)'}`);
    });
  } catch (error) {
    console.error('列出浏览器配置失败:', error.message);
  }
}

module.exports = {
  connectToBrowser,
  openBrowser,
  closeBrowser,
  getBrowserIdByIndex,
  getBrowserSeq,
  listBrowsers
};