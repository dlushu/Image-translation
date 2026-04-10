// worker.js - 修复Content-Type检查问题
export default {
  async fetch(request, env, ctx) {
    // 设置CORS头
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Content-Type': 'application/json; charset=utf-8'
    };

    // 处理预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders,
        status: 200,
      });
    }

    // 只允许POST请求
    if (request.method !== 'POST') {
      return errorResponse('请求方法不支持', '仅支持POST请求', 405, corsHeaders);
    }

    try {
      // 1. 请求认证（可选但推荐）
      if (env.REQUIRE_AUTH === 'true') {
        const authResult = await authenticateRequest(request, env);
        if (!authResult.authenticated) {
          return errorResponse('认证失败', authResult.message, 401, corsHeaders);
        }
      }

      // 2. 验证环境变量是否配置
      if (!env.BAIDU_API_KEY || !env.BAIDU_SECRET_KEY) {
        return errorResponse('服务器配置错误', '百度API密钥未正确配置', 500, corsHeaders);
      }

      // 3. 从环境变量获取配置
      const BAIDU_AI_CONFIG = {
        api_key: env.BAIDU_API_KEY,
        secret_key: env.BAIDU_SECRET_KEY,
        token_expire_sec: 2591000,
      };

      // 4. 解析请求数据 - 修复Content-Type检查
      let postData = {};
      const contentType = request.headers.get('content-type') || '';
      
      // 更灵活的Content-Type处理
      if (contentType.includes('application/json')) {
        // JSON格式
        try {
          postData = await request.json();
        } catch (e) {
          return errorResponse('JSON解析失败', '请求体不是有效的JSON格式', 400, corsHeaders);
        }
      } else if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
        // FormData格式
        try {
          const formData = await request.formData();
          for (const [key, value] of formData.entries()) {
            if (typeof value === 'string') {
              postData[key] = value;
            }
          }
        } catch (e) {
          return errorResponse('表单数据解析失败', '无法解析表单数据', 400, corsHeaders);
        }
      } else {
        // 尝试自动检测格式（很多前端库可能不会正确设置Content-Type）
        try {
          const bodyText = await request.text();
          
          // 尝试解析为JSON
          if (bodyText.trim().startsWith('{') || bodyText.trim().startsWith('[')) {
            try {
              postData = JSON.parse(bodyText);
            } catch (e) {
              // JSON解析失败，尝试作为普通文本处理
              postData = { raw_body: bodyText };
            }
          } else {
            // 尝试解析为查询字符串格式
            try {
              const params = new URLSearchParams(bodyText);
              for (const [key, value] of params.entries()) {
                postData[key] = value;
              }
            } catch (e) {
              postData = { raw_body: bodyText };
            }
          }
        } catch (e) {
          return errorResponse('请求体解析失败', '无法解析请求内容', 400, corsHeaders);
        }
      }

      // 5. 验证必要参数
      let useImageUrl = false;
      let imageSource = '';

      // 支持多种参数名称变体
      if ((postData.image_base64 && postData.image_base64 !== '') || 
          (postData.imageBase64 && postData.imageBase64 !== '') ||
          (postData.base64 && postData.base64 !== '')) {
        useImageUrl = false;
        imageSource = postData.image_base64 || postData.imageBase64 || postData.base64;
      } else if ((postData.image_url && postData.image_url !== '') || 
                 (postData.imageUrl && postData.imageUrl !== '') ||
                 (postData.url && postData.url !== '')) {
        useImageUrl = true;
        imageSource = postData.image_url || postData.imageUrl || postData.url;
      } else {
        return errorResponse('缺少必要参数', '请在请求中携带image_base64或image_url参数', 400, corsHeaders);
      }

      // 6. 处理图片源
      let imageBuffer = null;
      
      if (useImageUrl) {
        // 下载图片
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000);
          
          const imageResponse = await fetch(imageSource, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          });
          
          clearTimeout(timeoutId);
          
          if (!imageResponse.ok) {
            throw new Error(`图片URL下载失败: HTTP ${imageResponse.status}`);
          }
          
          const arrayBuffer = await imageResponse.arrayBuffer();
          imageBuffer = arrayBuffer;
        } catch (error) {
          return errorResponse('图片下载失败', error.message, 400, corsHeaders);
        }
      } else {
        // 处理Base64图片 - 更灵活的Base64处理
        try {
          // 移除可能的data URL前缀
          let pureBase64 = imageSource;
          if (imageSource.includes('base64,')) {
            pureBase64 = imageSource.split('base64,')[1];
          } else if (imageSource.includes(';base64,')) {
            pureBase64 = imageSource.split(';base64,')[1];
          }
          
          // 移除可能的空格和换行
          pureBase64 = pureBase64.replace(/\s/g, '');
          
          imageBuffer = base64ToArrayBuffer(pureBase64);
          
          if (imageBuffer.byteLength === 0) {
            throw new Error('Base64图片解码失败');
          }
        } catch (error) {
          return errorResponse('Base64解码失败', 'Base64格式可能不正确', 400, corsHeaders);
        }
      }

      // 7. 获取access token
      const accessToken = await getBaiduAiAccessToken(BAIDU_AI_CONFIG, env);
      if (!accessToken) {
        return errorResponse('百度AI认证失败', '无法获取访问令牌', 500, corsHeaders);
      }

      // 8. 调用百度AI图像翻译接口
      const formData = new FormData();
      formData.append('from', postData.from || 'auto');
      formData.append('to', postData.to || 'zh');
      formData.append('v', '3');
      formData.append('paste', '1');
      
      // 将ArrayBuffer转换为Blob
      const blob = new Blob([imageBuffer], { type: 'image/png' });
      formData.append('image', blob, 'trans_image.png');

      const apiUrl = `https://aip.baidubce.com/file/2.0/mt/pictrans/v1?access_token=${accessToken}`;
      
      try {
        const apiResponse = await fetch(apiUrl, {
          method: 'POST',
          body: formData,
        });

        if (!apiResponse.ok) {
          throw new Error(`百度AI接口请求失败: HTTP ${apiResponse.status}`);
        }

        const result = await apiResponse.json();

        // 9. 处理响应
        if (result.data && result.data.pasteImg) {
          return new Response(
            JSON.stringify({
              success: true,
              paste_img: result.data.pasteImg,
              api_detail: {
                from: result.data.from || 'auto',
                to: result.data.to || 'zh',
              },
            }),
            {
              status: 200,
              headers: corsHeaders,
            }
          );
        } else {
          return errorResponse(
            '未获取到翻译后图片', 
            result.error_msg || '百度AI接口未返回明确错误信息',
            500,
            corsHeaders
          );
        }
      } catch (error) {
        return errorResponse('百度AI接口调用失败', error.message, 500, corsHeaders);
      }

    } catch (error) {
      // 全局错误处理
      console.error('Unhandled error:', error);
      return errorResponse('服务器内部错误', '处理请求时发生意外错误', 500, corsHeaders);
    }
  },
};

// 辅助函数：Base64转ArrayBuffer
function base64ToArrayBuffer(base64) {
  try {
    // 使用atob解码base64
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  } catch (error) {
    // 如果atob失败，尝试使用Buffer（需要nodejs_compat标志）
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(base64, 'base64').buffer;
    }
    throw error;
  }
}

// 辅助函数：错误响应
function errorResponse(error, detail, status = 500, headers = {}) {
  return new Response(
    JSON.stringify({
      success: false,
      error: error,
      detail: detail,
    }),
    {
      status: status,
      headers: headers,
    }
  );
}

// 请求认证函数
async function authenticateRequest(request, env) {
  if (!env.REQUIRE_AUTH || env.REQUIRE_AUTH === 'false') {
    return { authenticated: true };
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { 
      authenticated: false, 
      message: '缺少Authorization头或格式不正确（应为Bearer token）' 
    };
  }

  const token = authHeader.substring(7);
  const validToken = env.API_TOKEN;

  if (!validToken) {
    return { 
      authenticated: false, 
      message: '服务器未配置认证令牌' 
    };
  }

  if (token !== validToken) {
    return { 
      authenticated: false, 
      message: '认证令牌无效' 
    };
  }

  return { authenticated: true };
}

// 获取百度AI access_token（使用KV缓存）
async function getBaiduAiAccessToken(config, env) {
  const cacheKey = 'baidu_ai_token';
  
  // 尝试从KV缓存获取token
  if (env.BAIDU_TOKEN_CACHE) {
    try {
      const cachedToken = await env.BAIDU_TOKEN_CACHE.get(cacheKey, 'json');
      if (cachedToken) {
        const currentTime = Math.floor(Date.now() / 1000);
        if (currentTime - cachedToken.get_time < config.token_expire_sec) {
          return cachedToken.access_token;
        }
      }
    } catch (error) {
      console.warn('KV缓存读取失败:', error.message);
    }
  }

  // 请求新token
  try {
    const tokenUrl = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${encodeURIComponent(config.api_key)}&client_secret=${encodeURIComponent(config.secret_key)}`;
    
    const response = await fetch(tokenUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const result = await response.json();
    
    if (!result.access_token) {
      throw new Error(result.error_description || '未返回access_token');
    }

    // 缓存到KV
    if (env.BAIDU_TOKEN_CACHE) {
      const tokenData = {
        access_token: result.access_token,
        get_time: Math.floor(Date.now() / 1000),
      };
      
      try {
        await env.BAIDU_TOKEN_CACHE.put(
          cacheKey, 
          JSON.stringify(tokenData),
          { expirationTtl: config.token_expire_sec }
        );
      } catch (error) {
        console.warn('KV缓存写入失败:', error.message);
      }
    }
    
    return result.access_token;
  } catch (error) {
    console.error('获取百度AI token失败:', error.message);
    return null;
  }
}
