// 显示插件界面
figma.showUI(__html__, { 
  width: 400, 
  title: "lumitrans"
});

// 初始设置合适的高度
figma.ui.resize(400, 200);

// 全局变量
let isTranslationStopped = false;

// 发送日志到UI
function sendLog(message, type = 'info') {
  figma.ui.postMessage({
    type: 'log',
    message,
    logType: type
  });
}

// 从客户端存储加载配置
async function loadConfig() {
  try {
    const savedConfig = await figma.clientStorage.getAsync('translatorConfig');
    if (savedConfig) {
      sendLog('配置加载成功', 'info');
    } else {
      sendLog('使用默认配置', 'info');
    }
    return savedConfig || {
      apiUrl: '',
      apiKey: '',
      modelName: 'gpt-4.1-nano',
      targetLanguage: 'zh-CN',
      customPrompt: '你是一个专业的翻译助手。请将用户提供的文本翻译成{targetLanguage}。只返回翻译结果，不要添加任何解释或其他内容。',
      customPrompts: [],
      customModels: []
    };
  } catch (error) {
    sendLog(`配置加载失败: ${error.message}`, 'error');
    throw error;
  }
}

// 保存配置到客户端存储
async function saveConfig(config) {
  try {
    await figma.clientStorage.setAsync('translatorConfig', config);
    sendLog('配置保存成功', 'success');
  } catch (error) {
    sendLog(`配置保存失败: ${error.message}`, 'error');
    throw error;
  }
}

// 获取选中的文本节点
function getSelectedTextNodes() {
  const textNodes = [];
  
  function traverse(node) {
    if (node.type === 'TEXT') {
      textNodes.push(node);
    } else if ('children' in node) {
      node.children.forEach(traverse);
    }
  }
  
  figma.currentPage.selection.forEach(traverse);
  return textNodes;
}

// 更新选中文本信息
function updateSelectedTextInfo() {
  const textNodes = getSelectedTextNodes();
  figma.ui.postMessage({
    type: 'selection-changed',
    count: textNodes.length
  });
}

// 监听选择变化
figma.on('selectionchange', () => {
  updateSelectedTextInfo();
});

// 处理来自UI的消息
figma.ui.onmessage = async (msg) => {
  try {
    switch (msg.type) {
      case 'load-config':
        const currentConfig = await loadConfig();
        figma.ui.postMessage({
          type: 'config-loaded',
          config: currentConfig
        });
        break;
        
      case 'save-config':
        await saveConfig(msg.config);
        figma.ui.postMessage({
          type: 'config-saved'
        });
        sendLog('API配置已更新', 'success');
        break;

      case 'save-language':
        const config = await loadConfig();
        config.targetLanguage = msg.language;
        await saveConfig(config);
        figma.ui.postMessage({
          type: 'language-saved',
          language: msg.language
        });
        sendLog(`目标语言已切换为: ${getLanguageName(msg.language)}`, 'info');
        break;

      case 'save-custom-prompt':
        const savePromptConfig = await loadConfig();
        const newPrompt = {
          id: Date.now().toString(),
          name: msg.name,
          content: msg.content
        };
        savePromptConfig.customPrompts = savePromptConfig.customPrompts || [];
        savePromptConfig.customPrompts.push(newPrompt);
        await saveConfig(savePromptConfig);
        figma.ui.postMessage({
          type: 'custom-prompt-saved',
          name: msg.name,
          prompts: savePromptConfig.customPrompts
        });
        sendLog(`新建提示词模板: ${msg.name}`, 'success');
        break;

      case 'delete-custom-prompt':
        const deletePromptConfig = await loadConfig();
        const promptToDelete = deletePromptConfig.customPrompts.find(p => p.id === msg.id);
        deletePromptConfig.customPrompts = deletePromptConfig.customPrompts.filter(p => p.id !== msg.id);
        await saveConfig(deletePromptConfig);
        figma.ui.postMessage({
          type: 'custom-prompt-deleted',
          name: promptToDelete ? promptToDelete.name : '未知',
          prompts: deletePromptConfig.customPrompts
        });
        sendLog(`删除提示词模板: ${promptToDelete ? promptToDelete.name : '未知'}`, 'info');
        break;

      case 'save-custom-model':
        const saveModelConfig = await loadConfig();
        const newModel = {
          id: Date.now().toString(),
          name: msg.name,
          modelName: msg.modelName
        };
        saveModelConfig.customModels = saveModelConfig.customModels || [];
        saveModelConfig.customModels.push(newModel);
        await saveConfig(saveModelConfig);
        figma.ui.postMessage({
          type: 'custom-model-saved',
          name: msg.name,
          models: saveModelConfig.customModels
        });
        sendLog(`新建模型: ${msg.name}`, 'success');
        break;

      case 'delete-custom-model':
        const deleteModelConfig = await loadConfig();
        const modelToDelete = deleteModelConfig.customModels.find(m => m.id === msg.id);
        deleteModelConfig.customModels = deleteModelConfig.customModels.filter(m => m.id !== msg.id);
        await saveConfig(deleteModelConfig);
        figma.ui.postMessage({
          type: 'custom-model-deleted',
          name: modelToDelete ? modelToDelete.name : '未知',
          models: deleteModelConfig.customModels
        });
        sendLog(`删除模型: ${modelToDelete ? modelToDelete.name : '未知'}`, 'info');
        break;
        
      case 'get-selected-text':
        updateSelectedTextInfo();
        break;

      case 'stop-translation':
        isTranslationStopped = true;
        figma.ui.postMessage({
          type: 'translation-stopped'
        });
        sendLog('手动停止翻译', 'warning');
        break;
        
      case 'translate':
        const selectedNodes = getSelectedTextNodes();
        if (selectedNodes.length === 0) {
          sendLog('未选择任何文本图层', 'warning');
          figma.ui.postMessage({
            type: 'error',
            message: '请先选择包含文本的图层'
          });
          return;
        }
        
        // 重置停止状态
        isTranslationStopped = false;
        
        // 开始翻译
        figma.ui.postMessage({
          type: 'translation-started'
        });
        sendLog(`开始翻译 ${selectedNodes.length} 个文本图层`, 'info');
        
        const translationConfig = await loadConfig();
        if (!translationConfig.apiUrl || !translationConfig.apiKey) {
          sendLog('API配置缺失', 'error');
          figma.ui.postMessage({
            type: 'error',
            message: '请先配置API地址和API Key'
          });
          return;
        }

        if (!translationConfig.modelName) {
          figma.ui.postMessage({
            type: 'error',
            message: '请先配置模型名称'
          });
          return;
        }
        
        // 翻译每个文本节点
        let completedCount = 0;
        let hasError = false;
        
        for (const node of selectedNodes) {
          // 检查是否被停止
          if (isTranslationStopped) {
            figma.ui.postMessage({
              type: 'translation-stopped-complete',
              completed: completedCount,
              total: selectedNodes.length
            });
            sendLog(`翻译已停止，已完成 ${completedCount}/${selectedNodes.length} 个文本`, 'warning');
            return;
          }
          
          // 显示当前正在处理的文本
          figma.ui.postMessage({
            type: 'translation-progress',
            completed: completedCount,
            total: selectedNodes.length,
            progress: Math.round((completedCount / selectedNodes.length) * 100),
            currentText: node.characters.substring(0, 30) + (node.characters.length > 30 ? '...' : ''),
            status: 'processing'
          });
          
          try {
            const translatedText = await translateText(
              node.characters, 
              translationConfig.apiUrl, 
              translationConfig.apiKey,
              translationConfig.modelName,
              translationConfig.targetLanguage,
              translationConfig.customPrompt
            );
            
            // 再次检查是否被停止（异步操作后）
            if (isTranslationStopped) {
              figma.ui.postMessage({
                type: 'translation-stopped-complete',
                completed: completedCount,
                total: selectedNodes.length
              });
              sendLog(`翻译已停止，已完成 ${completedCount}/${selectedNodes.length} 个文本`, 'warning');
              return;
            }
            
            // 处理字体加载和文本更新
            try {
              await loadNodeFonts(node);
              node.characters = translatedText;
            } catch (fontError) {
              console.error('字体加载失败:', fontError);
              // 尝试不加载字体直接更新文本
              try {
                node.characters = translatedText;
              } catch (textError) {
                throw new Error(`文本更新失败: ${textError.message}`);
              }
            }
            
            completedCount++;
            
            // 通知UI翻译进度
            figma.ui.postMessage({
              type: 'translation-progress',
              completed: completedCount,
              total: selectedNodes.length,
              progress: Math.round((completedCount / selectedNodes.length) * 100),
              currentText: node.characters.substring(0, 30) + (node.characters.length > 30 ? '...' : ''),
              status: 'completed'
            });
            
          } catch (error) {
            hasError = true;
            let errorMessage = `翻译失败: ${error.message}`;
            const textPreview = node.characters.substring(0, 20) + (node.characters.length > 20 ? '...' : '');
            
            // 为常见错误提供更友好的提示（中文）
            const msg = (error && error.message) ? error.message : '';
            const fontMatch = msg.match(/font\s+\"([^\"]+)\"/i);
            const fontNameText = fontMatch ? `（字体：${fontMatch[1]}）` : '';
            if (msg.includes('字体加载') || msg.includes('loadFontAsync')) {
              errorMessage = `文本 "${textPreview}" 字体加载失败${fontNameText}，请确认该字体在本机/Figma中可用，或将该文本图层切换为已安装字体后重试`;
            } else if (msg.includes('unloaded font') || msg.includes('set_characters')) {
              errorMessage = `文本 "${textPreview}" 字体未加载${fontNameText}，请先在Figma中加载该字体，或将该文本图层更换为已安装字体后再试`;
            } else if (msg.includes('网络')) {
              errorMessage = `文本 "${textPreview}" 网络请求失败，请检查网络连接和API配置`;
            } else if (msg.includes('API')) {
              errorMessage = `文本 "${textPreview}" API调用失败: ${msg}`;
            } else {
              errorMessage = `文本 "${textPreview}" 翻译失败: ${msg}`;
            }
            
            figma.ui.postMessage({
              type: 'error',
              message: errorMessage
            });
            // 发生错误时继续翻译其他文本，不中断整个流程
          }
        }
        
        // 如果没有被停止，发送完成消息
        if (!isTranslationStopped) {
          figma.ui.postMessage({
            type: 'translation-completed',
            completed: completedCount,
            total: selectedNodes.length,
            hasError: hasError
          });
          sendLog(
            hasError 
              ? `翻译完成，成功: ${completedCount}/${selectedNodes.length} (部分失败)` 
              : `翻译完成，全部成功: ${completedCount}/${selectedNodes.length}`,
            hasError ? 'warning' : 'success'
          );
        }
        break;
        
      case 'close':
        figma.closePlugin();
        break;
        
      case 'resize-ui':
        // 动态调整UI高度
        const newWidth = msg.width || 400;
        const newHeight = Math.min(Math.max(msg.height || 500, 400), 800); // 限制在400-800px之间
        figma.ui.resize(newWidth, newHeight);
        break;
    }
  } catch (error) {
    sendLog(`操作失败: ${error.message}`, 'error');
    figma.ui.postMessage({
      type: 'error',
      message: `操作失败: ${error.message}`
    });
  }
};

// 翻译文本函数
async function translateText(text, apiUrl, apiKey, modelName, targetLang, customPrompt) {
  // 构建系统提示词，支持占位符替换
  let systemPrompt = customPrompt || '你是一个专业的翻译助手。请将用户提供的文本翻译成{targetLanguage}。只返回翻译结果，不要添加任何解释或其他内容。';
  
  // 替换占位符
  const languageName = getLanguageName(targetLang);
  systemPrompt = systemPrompt
    .replace(/\{targetLanguage\}/g, languageName)
    .replace(/\{targetLang\}/g, targetLang)
    .replace(/\{language\}/g, languageName);

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modelName,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: text
        }
      ],
      temperature: 0.3,
      max_tokens: 1000
    })
  });
  
  if (!response.ok) {
    throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.choices[0].message.content.trim();
}

// 加载节点字体
async function loadNodeFonts(node) {
  if (node.type !== 'TEXT') {
    return;
  }

  try {
    // 检查是否为混合字体
    if (node.fontName === figma.mixed) {
      // 如果是混合字体，获取所有字体样式段
      const styledTextSegments = node.getStyledTextSegments(['fontName']);
      const uniqueFonts = new Set();
      
      // 收集所有唯一的字体
      styledTextSegments.forEach(segment => {
        if (segment.fontName && segment.fontName !== figma.mixed) {
          uniqueFonts.add(JSON.stringify(segment.fontName));
        }
      });
      
      // 加载所有唯一字体
      for (const fontString of uniqueFonts) {
        const font = JSON.parse(fontString);
        await figma.loadFontAsync(font);
      }
    } else {
      // 如果不是混合字体，按原来方式加载
      await figma.loadFontAsync(node.fontName);
    }
  } catch (error) {
    console.warn('字体加载警告:', error.message);
    // 如果字体加载失败，尝试加载默认字体
    try {
      await figma.loadFontAsync({ family: "Roboto", style: "Regular" });
    } catch (defaultError) {
      // 如果连默认字体都失败，抛出错误
      throw new Error(`无法加载任何字体: ${error.message}`);
    }
  }
}

// 获取语言名称
function getLanguageName(langCode) {
  const languages = {
    'zh-CN': '简体中文',
    'zh-TW': '繁体中文',
    'en': '英语',
    'ja': '日语',
    'ko': '韩语',
    'fr': '法语',
    'de': '德语',
    'es': '西班牙语',
    'ru': '俄语',
    'ar': '阿拉伯语',
    'pt': '葡萄牙语',
    'it': '意大利语',
    'nl': '荷兰语',
    'sv': '瑞典语',
    'da': '丹麦语',
    'no': '挪威语',
    'fi': '芬兰语',
    'pl': '波兰语',
    'cs': '捷克语',
    'hu': '匈牙利语',
    'tr': '土耳其语',
    'th': '泰语',
    'vi': '越南语',
    'hi': '印地语',
    'he': '希伯来语',
    'uk': '乌克兰语'
  };
  return languages[langCode] || langCode;
}

// 初始化
figma.ui.postMessage({ type: 'init' });

// 初始更新选中信息
updateSelectedTextInfo(); 