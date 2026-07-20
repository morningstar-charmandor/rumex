#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>
#import <fcntl.h>
#import <sys/file.h>
#import <unistd.h>

static NSString *const RumexNotchStopNotification = @"com.rumex.notch-helper.stop";
static int RumexNotchLockFD = -1;

static BOOL AcquireNotchSingleton(NSString *commandPath) {
  // Ask any helper from the previous app/dev launch to leave first. Registering
  // happens only after this process owns the lock, so it cannot stop itself.
  [NSDistributedNotificationCenter.defaultCenter postNotificationName:RumexNotchStopNotification object:nil];
  usleep(180000);
  NSString *lockPath=[commandPath stringByAppendingString:@".lock"];
  RumexNotchLockFD=open(lockPath.fileSystemRepresentation,O_CREAT|O_RDWR,0600);
  if (RumexNotchLockFD<0 || flock(RumexNotchLockFD,LOCK_EX|LOCK_NB)!=0) return NO;
  ftruncate(RumexNotchLockFD,0);
  NSString *pid=[NSString stringWithFormat:@"%d\n",getpid()];
  write(RumexNotchLockFD,pid.UTF8String,strlen(pid.UTF8String));
  return YES;
}

static NSColor *HexColor(NSString *hex) {
  NSString *s = [hex stringByTrimmingCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@"#"]];
  if (s.length != 6) return NSColor.systemBlueColor;
  unsigned rgb = 0; [[NSScanner scannerWithString:s] scanHexInt:&rgb];
  return [NSColor colorWithRed:((rgb >> 16) & 255) / 255.0 green:((rgb >> 8) & 255) / 255.0 blue:(rgb & 255) / 255.0 alpha:1];
}

static NSImage *DataImage(NSString *uri) {
  if (![uri isKindOfClass:NSString.class]) return nil;
  NSRange comma = [uri rangeOfString:@","];
  if (comma.location == NSNotFound) return nil;
  NSData *data = [[NSData alloc] initWithBase64EncodedString:[uri substringFromIndex:NSMaxRange(comma)] options:0];
  return data ? [[NSImage alloc] initWithData:data] : nil;
}

@interface IconView : NSView
@property NSDictionary *item;
@property BOOL selected;
@property BOOL appIcon;
@end

@implementation IconView
- (void)drawRect:(NSRect)dirty {
  NSRect tile = NSInsetRect(self.bounds, 2, 2);
  CGFloat radius = NSWidth(tile) * .24;
  NSBezierPath *shape = [NSBezierPath bezierPathWithRoundedRect:tile xRadius:radius yRadius:radius];
  NSImage *image = DataImage(self.item[self.appIcon ? @"favicon" : @"iconImage"]);
  if (image) {
    [NSGraphicsContext saveGraphicsState];
    [shape addClip];
    [image drawInRect:tile fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:1];
    [NSGraphicsContext restoreGraphicsState];
  } else {
    [[HexColor(self.item[@"color"] ?: (self.appIcon ? @"#ff4f1f" : @"#3b82f6")) colorWithAlphaComponent:self.selected ? 1 : .9] setFill];
    [shape fill];
    NSString *icon = self.appIcon ? nil : self.item[@"icon"];
    NSString *name = self.item[@"name"] ?: @"?";
    NSString *value = icon.length ? icon : [[name substringToIndex:MIN((NSUInteger)1, name.length)] uppercaseString];
    NSDictionary *attrs = @{NSFontAttributeName:[NSFont systemFontOfSize:icon.length ? 17 : 12 weight:NSFontWeightSemibold], NSForegroundColorAttributeName:NSColor.whiteColor};
    NSSize size = [value sizeWithAttributes:attrs];
    [value drawAtPoint:NSMakePoint(NSMidX(self.bounds)-size.width/2, NSMidY(self.bounds)-size.height/2) withAttributes:attrs];
  }
}
@end

@interface RumexNotchPanel : NSPanel @end
@implementation RumexNotchPanel
- (BOOL)canBecomeKeyWindow { return YES; }
- (BOOL)canBecomeMainWindow { return NO; }
@end

@interface NotchSurfaceView : NSView
@property BOOL expandedStyle;
@property CGFloat expansionProgress;
@end

@implementation NotchSurfaceView
- (void)updateShapeMask {
  CGFloat width=NSWidth(self.bounds), height=NSHeight(self.bounds);
  if (width<=0 || height<=0) return;
  CGFloat progress=MAX(0,MIN(1,self.expansionProgress));
  CGFloat shoulder=4+20*progress;
  CGFloat bottomRadius=8+20*progress;
  shoulder=MIN(shoulder,height*.46);
  bottomRadius=MIN(bottomRadius,(height-shoulder)*.72);
  CGMutablePathRef path=CGPathCreateMutable();
  CGPathMoveToPoint(path,NULL,0,height);
  CGPathAddLineToPoint(path,NULL,width,height);
  // Concave shoulders: the black top edge curls inward before becoming the
  // vertical side, matching the physical notch-to-screen transition.
  CGPathAddCurveToPoint(path,NULL,width-shoulder*.18,height,width-shoulder,height-shoulder*.18,width-shoulder,height-shoulder);
  CGPathAddLineToPoint(path,NULL,width-shoulder,bottomRadius);
  CGPathAddCurveToPoint(path,NULL,width-shoulder,bottomRadius*.45,width-shoulder-bottomRadius*.45,0,width-shoulder-bottomRadius,0);
  CGPathAddLineToPoint(path,NULL,shoulder+bottomRadius,0);
  CGPathAddCurveToPoint(path,NULL,shoulder+bottomRadius*.45,0,shoulder,bottomRadius*.45,shoulder,bottomRadius);
  CGPathAddLineToPoint(path,NULL,shoulder,height-shoulder);
  CGPathAddCurveToPoint(path,NULL,shoulder,height-shoulder*.18,shoulder*.18,height,0,height);
  CGPathCloseSubpath(path);
  CAShapeLayer *mask=[CAShapeLayer layer]; mask.frame=self.bounds; mask.path=path;
  self.layer.mask=mask; CGPathRelease(path);
}
- (void)layout { [super layout]; [self updateShapeMask]; }
- (void)setFrameSize:(NSSize)newSize { [super setFrameSize:newSize]; [self updateShapeMask]; }
@end

@interface NotchController : NSObject <NSApplicationDelegate>
@property NSString *statePath;
@property NSString *commandPath;
@property NSImage *logoImage;
@property NSData *lastStateData;
@property NSDictionary *state;
@property RumexNotchPanel *panel;
@property NSView *host;
@property NSView *surface;
@property NSTimer *stateTimer;
@property NSTimer *hoverTimer;
@property NSTimer *geometryTimer;
@property id clickMonitor;
@property NSArray<NSDictionary *> *clickTargets;
@property NSArray<NSDictionary *> *compactTargets;
@property NSRect surfaceScreenRect;
@property NSString *hoverContextId;
@property NSTimeInterval hoverBegan;
@property NSTimeInterval pointerLeftAt;
@property NSString *expandedContextId;
@property BOOL animating;
@end

@implementation NotchController
- (instancetype)initWithState:(NSString *)state command:(NSString *)command logo:(NSString *)logoPath {
  if ((self = [super init])) {
    _statePath = state;
    _commandPath = command;
    _logoImage = [[NSImage alloc] initWithContentsOfFile:logoPath];
  }
  return self;
}
- (void)applicationDidFinishLaunching:(NSNotification *)note {
  [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
  [NSDistributedNotificationCenter.defaultCenter addObserver:self selector:@selector(stopForReplacement:) name:RumexNotchStopNotification object:nil];
  __weak typeof(self) weakSelf = self;
  self.clickMonitor = [NSEvent addGlobalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown handler:^(NSEvent *event) {
    [weakSelf handleClick:NSEvent.mouseLocation];
  }];
  [self refresh];
  self.stateTimer = [NSTimer scheduledTimerWithTimeInterval:.5 target:self selector:@selector(refresh) userInfo:nil repeats:YES];
  self.hoverTimer = [NSTimer scheduledTimerWithTimeInterval:.05 target:self selector:@selector(updateHover) userInfo:nil repeats:YES];
}
- (void)stopForReplacement:(NSNotification *)note { [NSApp terminate:nil]; }
- (NSScreen *)builtInScreen {
  for (NSScreen *s in NSScreen.screens) if ([s.localizedName localizedCaseInsensitiveContainsString:@"built-in"]) return s;
  for (NSScreen *s in NSScreen.screens) if (s.safeAreaInsets.top > 0) return s;
  return nil;
}
- (void)refresh {
  NSData *data = [NSData dataWithContentsOfFile:self.statePath];
  if (!data || [data isEqualToData:self.lastStateData]) return;
  NSDictionary *state = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![state isKindOfClass:NSDictionary.class]) return;
  if (![state[@"settings"] isKindOfClass:NSDictionary.class] || ![state[@"settings"][@"notchSwitcher"] boolValue]) {
    [self.panel orderOut:nil];
    [NSApp terminate:nil];
    return;
  }
  self.lastStateData = data; self.state = state;
  if (self.expandedContextId && ![self context:self.expandedContextId]) self.expandedContextId = nil;
  [self renderExpanded:self.expandedContextId animated:NO];
}
- (NSDictionary *)context:(NSString *)contextId {
  for (NSDictionary *c in self.state[@"contexts"] ?: @[]) if ([c[@"id"] isEqualToString:contextId]) return c;
  return nil;
}
- (void)ensurePanel:(NSScreen *)screen {
  if (self.panel) return;
  CGFloat hostWidth = screen.frame.size.width, hostHeight = screen.frame.size.height / 2;
  NSPoint origin = NSMakePoint(NSMidX(screen.frame)-hostWidth/2, NSMaxY(screen.frame)-hostHeight);
  self.panel = [[RumexNotchPanel alloc] initWithContentRect:NSZeroRect styleMask:NSWindowStyleMaskBorderless|NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:YES];
  self.panel.level = NSScreenSaverWindowLevel;
  self.panel.opaque = NO; self.panel.backgroundColor = NSColor.clearColor; self.panel.hasShadow = NO;
  self.panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces|NSWindowCollectionBehaviorStationary|NSWindowCollectionBehaviorFullScreenAuxiliary;
  self.panel.ignoresMouseEvents = YES;
  self.host = [[NSView alloc] initWithFrame:NSMakeRect(0,0,hostWidth,hostHeight)];
  self.host.wantsLayer = YES; self.host.layer.backgroundColor = NSColor.clearColor.CGColor;
  self.panel.contentView = self.host;
  [self.panel setFrame:NSMakeRect(origin.x,origin.y,hostWidth,hostHeight) display:NO];
  [self.panel orderFrontRegardless];
}
- (NSTextField *)label:(NSString *)text size:(CGFloat)size weight:(NSFontWeight)weight {
  NSTextField *label = [NSTextField labelWithString:text ?: @""];
  label.font = [NSFont systemFontOfSize:size weight:weight]; label.textColor = NSColor.whiteColor;
  label.lineBreakMode = NSLineBreakByTruncatingTail;
  return label;
}
- (IconView *)addContextIcon:(NSDictionary *)context frame:(NSRect)frame selected:(BOOL)selected to:(NSView *)view {
  IconView *icon = [[IconView alloc] initWithFrame:frame]; icon.item = context; icon.selected = selected; icon.appIcon = NO; icon.wantsLayer=YES; [view addSubview:icon]; return icon;
}
- (void)addAppIcon:(NSDictionary *)app frame:(NSRect)frame to:(NSView *)view {
  IconView *icon = [[IconView alloc] initWithFrame:frame]; icon.item = app; icon.appIcon = YES; [view addSubview:icon];
}
- (void)addRumexBrandTo:(NSView *)view width:(CGFloat)width height:(CGFloat)height {
  if (!self.logoImage) return;

  // A warm radial pool behind the logo echoes the orange light spilling out
  // from beneath the icon in the product artwork. The surface mask clips the
  // glow cleanly to the physical-notch silhouette.
  CGFloat glowWidth=150;
  NSView *glow=[[NSView alloc] initWithFrame:NSMakeRect(width-glowWidth,0,glowWidth,height)];
  glow.wantsLayer=YES;
  CAGradientLayer *gradient=[CAGradientLayer layer];
  gradient.frame=glow.bounds;
  gradient.type=kCAGradientLayerRadial;
  gradient.startPoint=CGPointMake(.72,.12);
  gradient.endPoint=CGPointMake(.05,1.0);
  gradient.colors=@[(id)[NSColor colorWithRed:1 green:.34 blue:.03 alpha:.78].CGColor,
                    (id)[NSColor colorWithRed:1 green:.30 blue:.02 alpha:.28].CGColor,
                    (id)NSColor.clearColor.CGColor];
  gradient.locations=@[@0,@.42,@1];
  [glow.layer addSublayer:gradient];
  [view addSubview:glow];

  CGFloat logoSize=30;
  NSImageView *logo=[[NSImageView alloc] initWithFrame:NSMakeRect(width-8-logoSize,(height-logoSize)/2,logoSize,logoSize)];
  logo.image=self.logoImage;
  logo.imageScaling=NSImageScaleProportionallyUpOrDown;
  [view addSubview:logo];
}
- (void)renderExpanded:(NSString *)contextId animated:(BOOL)animated {
  NSScreen *screen = [self builtInScreen];
  if (!screen || screen.safeAreaInsets.top <= 0 || !self.state) { [self.panel orderOut:nil]; return; }
  [self ensurePanel:screen];
  NSArray *contexts = self.state[@"contexts"] ?: @[];
  NSDictionary *context = contextId ? [self context:contextId] : nil;
  NSString *active = [self.state[@"activeApp"] isKindOfClass:NSDictionary.class] ? self.state[@"activeApp"][@"contextId"] : nil;
  // The collapsed state deliberately reads as one continuous physical notch:
  // context shortcuts sit at the far left while the centre/right remain black.
  CGFloat compactW = MIN(400,screen.frame.size.width), compactH = MAX(36,screen.safeAreaInsets.top);
  NSRect compactScreen = NSMakeRect(NSMidX(screen.frame)-compactW/2, NSMaxY(screen.frame)-compactH, compactW, compactH);
  NSArray *apps = context[@"apps"] ?: @[];
  CGFloat expandedW = screen.frame.size.width*.60, rowH = 38;
  CGFloat expandedH = context ? MIN(230,MAX(180,68+MIN((NSUInteger)3,MAX((NSUInteger)1,apps.count))*rowH)) : compactH;
  NSRect finalScreen = context ? NSMakeRect(NSMidX(screen.frame)-expandedW/2, NSMaxY(screen.frame)-expandedH, expandedW, expandedH) : compactScreen;
  NSRect panelFrame = self.panel.frame;
  NSRect finalLocal = NSOffsetRect(finalScreen,-panelFrame.origin.x,-panelFrame.origin.y);
  NSRect startLocal = self.surface ? self.surface.frame : NSOffsetRect(compactScreen,-panelFrame.origin.x,-panelFrame.origin.y);
  BOOL swappingContexts = context && [self.surface isKindOfClass:NotchSurfaceView.class] && ((NotchSurfaceView *)self.surface).expandedStyle;
  BOOL collapsing = !context && [self.surface isKindOfClass:NotchSurfaceView.class] && ((NotchSurfaceView *)self.surface).expandedStyle;

  NotchSurfaceView *next = [[NotchSurfaceView alloc] initWithFrame:animated ? startLocal : finalLocal];
  next.expandedStyle = context != nil;
  next.expansionProgress = context ? 1 : 0;
  next.wantsLayer = YES; next.layer.backgroundColor = [NSColor colorWithWhite:0 alpha:.98].CGColor;
  next.layer.masksToBounds = YES; [next updateShapeMask];
  NSMutableArray *targets = [NSMutableArray array];
  NSMutableArray *compactTargets = [NSMutableArray array];
  if (!context) {
    [self addRumexBrandTo:next width:compactW height:compactH];
    CGFloat x = 8, y = (compactH-28)/2;
    [contexts enumerateObjectsUsingBlock:^(NSDictionary *c, NSUInteger i, BOOL *stop) {
      if (x+i*32+28 > compactW-46) { *stop=YES; return; }
      BOOL selected=[active isEqualToString:c[@"id"]];
      IconView *icon=[self addContextIcon:c frame:NSMakeRect(x+i*32,y,28,28) selected:selected to:next];
      NSRect global = NSMakeRect(compactScreen.origin.x+x+i*32, compactScreen.origin.y+y, 28, 28);
      NSMutableDictionary *target = [@{@"kind":@"context",@"contextId":c[@"id"],@"rect":[NSValue valueWithRect:global],@"hoverView":icon,@"baseAlpha":@(selected?1:.86),@"hovered":@NO} mutableCopy];
      icon.alphaValue=[target[@"baseAlpha"] doubleValue];
      [targets addObject:target]; [compactTargets addObject:target];
    }];
  } else {
    CGFloat iconX = 44, iconY = expandedH-52;
    [contexts enumerateObjectsUsingBlock:^(NSDictionary *c, NSUInteger i, BOOL *stop) {
      CGFloat x = iconX+i*36;
      BOOL selected=[c[@"id"] isEqualToString:contextId];
      IconView *icon=[self addContextIcon:c frame:NSMakeRect(x,iconY,32,32) selected:selected to:next]; icon.alphaValue=selected?1:.82;
      [targets addObject:[@{@"kind":@"context",@"contextId":c[@"id"],@"rect":[NSValue valueWithRect:NSMakeRect(finalScreen.origin.x+x,finalScreen.origin.y+iconY,32,32)],@"hoverView":icon,@"baseAlpha":@(selected?1:.82),@"hovered":@NO} mutableCopy]];
    }];
    CGFloat top = expandedH-67;
    if (apps.count == 0) {
      NSTextField *empty = [self label:@"No apps in this space" size:13 weight:NSFontWeightRegular]; empty.textColor = [NSColor colorWithWhite:.65 alpha:1]; empty.frame = NSMakeRect(32,top-32,300,22); [next addSubview:empty];
    }
    [apps enumerateObjectsUsingBlock:^(NSDictionary *app, NSUInteger i, BOOL *stop) {
      if (i >= 9) { *stop=YES; return; }
      NSUInteger column=i/3,row=i%3;
      CGFloat columnW=(expandedW-72)/3, x=32+column*columnW, y=top-(row+1)*rowH;
      BOOL activeApp=[self.state[@"activeApp"] isKindOfClass:NSDictionary.class] && [self.state[@"activeApp"][@"contextId"] isEqualToString:contextId] && [self.state[@"activeApp"][@"appId"] isEqualToString:app[@"id"]];
      NSView *highlight=[[NSView alloc] initWithFrame:NSMakeRect(x,y+2,columnW-12,rowH-4)]; highlight.wantsLayer=YES; highlight.layer.cornerRadius=10; highlight.layer.backgroundColor=[NSColor colorWithRed:.23 green:.13 blue:.09 alpha:1].CGColor; highlight.alphaValue=activeApp?1:0; [next addSubview:highlight];
      [self addAppIcon:app frame:NSMakeRect(x+8,y+7,28,28) to:next];
      NSTextField *name=[self label:app[@"name"] ?: app[@"url"] size:14 weight:NSFontWeightRegular]; name.frame=NSMakeRect(x+43,y+10,columnW-60,21); [next addSubview:name];
      [targets addObject:[@{@"kind":@"app",@"contextId":context[@"id"],@"appId":app[@"id"],@"rect":[NSValue valueWithRect:NSMakeRect(finalScreen.origin.x+x,finalScreen.origin.y+y+2,columnW-12,rowH-4)],@"hoverView":highlight,@"baseAlpha":@(activeApp?1:0),@"hovered":@NO} mutableCopy]];
    }];
  }
  [self.host addSubview:next];
  NSView *old = self.surface; self.surface = next; self.clickTargets = targets; self.compactTargets = compactTargets; self.surfaceScreenRect = finalScreen;
  if (animated) {
    self.animating = YES;
    if (collapsing) {
      // Animate the currently visible panel all the way to the compact frame.
      // Swapping surfaces at the start caused the end-of-transition snap.
      [next removeFromSuperview]; self.surface=old; old.alphaValue=1;
      [self.geometryTimer invalidate];
      NSRect initialFrame=old.frame; NSTimeInterval began=NSDate.date.timeIntervalSince1970; NSTimeInterval duration=.36;
      __weak typeof(self) weakSelf=self;
      self.geometryTimer=[NSTimer scheduledTimerWithTimeInterval:1.0/60.0 repeats:YES block:^(NSTimer *timer) {
        typeof(self) strongSelf=weakSelf; if (!strongSelf) { [timer invalidate]; return; }
        CGFloat linear=MIN(1,(NSDate.date.timeIntervalSince1970-began)/duration);
        CGFloat eased=1-pow(1-linear,3);
        NSRect frame=NSMakeRect(initialFrame.origin.x+(finalLocal.origin.x-initialFrame.origin.x)*eased,
                                initialFrame.origin.y+(finalLocal.origin.y-initialFrame.origin.y)*eased,
                                initialFrame.size.width+(finalLocal.size.width-initialFrame.size.width)*eased,
                                initialFrame.size.height+(finalLocal.size.height-initialFrame.size.height)*eased);
        old.frame=frame;
        ((NotchSurfaceView *)old).expansionProgress=1-eased;
        [((NotchSurfaceView *)old) updateShapeMask];
        if (linear>=1) {
          [timer invalidate]; strongSelf.geometryTimer=nil;
          next.frame=finalLocal; [strongSelf.host addSubview:next]; [old removeFromSuperview];
          strongSelf.surface=next; strongSelf.animating=NO;
        }
      }];
      [[NSRunLoop mainRunLoop] addTimer:self.geometryTimer forMode:NSRunLoopCommonModes];
    } else if (swappingContexts) {
      // Keep the new black surface fully opaque. Only the outgoing content
      // fades, avoiding the grey/black opacity pulse seen between contexts.
      next.frame=finalLocal; next.alphaValue=1;
      old.layer.backgroundColor=NSColor.clearColor.CGColor;
      [NSAnimationContext runAnimationGroup:^(NSAnimationContext *ctx) { ctx.duration=.14; old.animator.alphaValue=0; } completionHandler:^{ [old removeFromSuperview]; self.animating=NO; }];
    } else {
      next.alphaValue = context ? .18 : .6;
      [NSAnimationContext runAnimationGroup:^(NSAnimationContext *ctx) { ctx.duration=context ? .38 : .30; ctx.timingFunction=[CAMediaTimingFunction functionWithControlPoints:.16 :.88 :.25 :1.0]; next.animator.frame=finalLocal; next.animator.alphaValue=1; old.animator.alphaValue=0; } completionHandler:^{ [old removeFromSuperview]; self.animating=NO; }];
    }
  } else { [old removeFromSuperview]; }
}
- (void)updateItemHoverAtPoint:(NSPoint)point {
  for (NSMutableDictionary *target in self.clickTargets) {
    NSView *view=target[@"hoverView"]; if (!view) continue;
    BOOL hovered=NSPointInRect(point,[target[@"rect"] rectValue]);
    if ([target[@"hovered"] boolValue]==hovered) continue;
    target[@"hovered"]=@(hovered);
    CGFloat base=[target[@"baseAlpha"] doubleValue], alpha=hovered?1:base;
    [NSAnimationContext runAnimationGroup:^(NSAnimationContext *ctx) {
      ctx.duration=.20;
      ctx.timingFunction=[CAMediaTimingFunction functionWithControlPoints:.22 :.78 :.24 :1.0];
      view.animator.alphaValue=alpha;
    } completionHandler:nil];
    if ([target[@"kind"] isEqualToString:@"context"]) {
      CGFloat scale=hovered?1.055:1.0; CALayer *layer=view.layer;
      NSNumber *current=[layer.presentationLayer valueForKeyPath:@"transform.scale"] ?: [layer valueForKeyPath:@"transform.scale"] ?: @1;
      CABasicAnimation *motion=[CABasicAnimation animationWithKeyPath:@"transform.scale"];
      motion.fromValue=current; motion.toValue=@(scale); motion.duration=.20;
      motion.timingFunction=[CAMediaTimingFunction functionWithControlPoints:.22 :.78 :.24 :1.0];
      [layer setValue:@(scale) forKeyPath:@"transform.scale"];
      [layer addAnimation:motion forKey:@"rumexItemHover"];
    }
  }
}
- (void)updateHover {
  if (self.animating || !self.state) return;
  NSPoint p = NSEvent.mouseLocation;
  if (self.expandedContextId) {
    if (NSPointInRect(p,self.surfaceScreenRect)) {
      self.pointerLeftAt=0;
      [self updateItemHoverAtPoint:p];
      // Once open, context-to-context browsing is immediate. The one-second
      // dwell applies only to opening the collapsed notch.
      for (NSDictionary *target in self.clickTargets) {
        if ([target[@"kind"] isEqualToString:@"context"] &&
            NSPointInRect(p,[target[@"rect"] rectValue]) &&
            ![target[@"contextId"] isEqualToString:self.expandedContextId]) {
          self.expandedContextId=target[@"contextId"];
          [self renderExpanded:self.expandedContextId animated:YES];
          break;
        }
      }
      return;
    }
    NSTimeInterval now=NSDate.date.timeIntervalSince1970;
    if (!self.pointerLeftAt) { self.pointerLeftAt=now; return; }
    if (now-self.pointerLeftAt >= .22) { self.expandedContextId=nil; self.hoverContextId=nil; self.pointerLeftAt=0; [self renderExpanded:nil animated:YES]; }
    return;
  }
  [self updateItemHoverAtPoint:p];
  NSString *over = nil;
  for (NSDictionary *target in self.compactTargets) if (NSPointInRect(p,[target[@"rect"] rectValue])) { over=target[@"contextId"]; break; }
  if (!over) { self.hoverContextId=nil; self.hoverBegan=0; return; }
  NSTimeInterval now = NSDate.date.timeIntervalSince1970;
  if (![over isEqualToString:self.hoverContextId]) { self.hoverContextId=over; self.hoverBegan=now; return; }
  if (now-self.hoverBegan >= 1.0) { self.expandedContextId=over; [self renderExpanded:over animated:YES]; }
}
- (void)handleClick:(NSPoint)point {
  for (NSDictionary *target in self.clickTargets) if (NSPointInRect(point,[target[@"rect"] rectValue])) { [self send:target]; return; }
}
- (void)send:(NSDictionary *)target {
  NSMutableDictionary *command = [@{@"kind":target[@"kind"] ?: @"context",@"contextId":target[@"contextId"],@"nonce":@(NSDate.date.timeIntervalSince1970)} mutableCopy];
  if (target[@"appId"]) command[@"appId"] = target[@"appId"];
  NSData *data=[NSJSONSerialization dataWithJSONObject:command options:0 error:nil]; [data writeToFile:self.commandPath options:NSDataWritingAtomic error:nil];
}
@end

int main(int argc,const char *argv[]) {
  @autoreleasepool {
    if (argc<4) return 2;
    if (!AcquireNotchSingleton(@(argv[2]))) return 0;
    NSApplication *app=NSApplication.sharedApplication;
    NotchController *controller=[[NotchController alloc] initWithState:@(argv[1]) command:@(argv[2]) logo:@(argv[3])];
    app.delegate=controller; [app run];
  }
  return 0;
}
